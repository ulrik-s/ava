"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { ClientPickerDialog } from "@/components/contacts/client-picker-dialog";
import type { PickedClient } from "@/components/contacts/new-client-dialog";
import { ListPage } from "@/components/layout/list-page";
import { ConflictMatchBadge } from "@/components/matter/conflict-match-badge";
import { MatterTypeSelect } from "@/components/matter/matter-type-select";
import { DataTable } from "@/components/ui/data-table";
import { Pager } from "@/components/ui/pager";
import { TabBar, type TabBarTab } from "@/components/ui/tab-bar";
import { useIsReadOnly } from "@/lib/client/demo/demo-mode-context";
import { useTRPC } from "@/lib/client/trpc";
import { MatterFilters, type NamedOption, type StatusFilter } from "./_matter-filters";
import { EMPTY_MATTER_FORM, matterCreateArgs, withPickedClient, type MatterForm } from "./_matter-form";
import { type MatterSearch, useMatterSearch } from "./_use-matter-search";
import { type MattersTab, useMattersTab, usePageForTab } from "./_use-matters-tab";

type ListParams = { search: string; status: StatusFilter; employeeId: string; page: number };

/** Bygg query-args för matter.list (flyttar `|| undefined`-grenarna ut ur
 *  MattersContent → håller den under complexity@8). */
function matterListArgs(p: ListParams) {
  return {
    search: p.search,
    status: p.status || undefined,
    employeeId: p.employeeId || undefined,
    page: p.page,
    pageSize: 20,
  };
}

/** Mitt aktskåp (#1968): aktiva ärenden där den inloggade är ansvarig, senast hänt överst. */
function mineListArgs(p: ListParams) {
  return { search: p.search, mine: true, status: "ACTIVE" as const, orderBy: "lastActivity" as const, page: p.page, pageSize: 20 };
}

/**
 * `matter.list`-frågan per flik (#1968). Mitt aktskåp läses om varje gång
 * fliken visas (`staleTime: 0`): tidsposter, utlägg och dokument invaliderar
 * inte `matter.list`, så appens standard skulle visa en gammal ordning.
 */
function mattersTabQuery(tab: MattersTab, p: ListParams) {
  return tab === "mine"
    ? { args: mineListArgs(p), opts: { staleTime: 0 } }
    : { args: matterListArgs(p), opts: undefined };
}

/** Flikarnas namn, tabellinställningar och tomtext (#1968). */
const TAB_VIEW: Readonly<Record<MattersTab, { label: string; prefKey: string; empty: string }>> = {
  mine: { label: "Mitt aktskåp", prefKey: "list.matters-mine", empty: "Du är inte ansvarig för något aktivt ärende." },
  all: { label: "Alla ärenden på byrån", prefKey: "list.matters", empty: "Inga ärenden." },
};

const MATTERS_TABS: readonly TabBarTab<MattersTab>[] = (["mine", "all"] as const).map((id) => ({ id, label: TAB_VIEW[id].label }));

/** Tomtexten: med söktext alltid "Inga ärenden.", annars flikens egen. */
function mattersEmptyMessage(tab: MattersTab, search: string): string {
  return search.trim() ? "Inga ärenden." : TAB_VIEW[tab].empty;
}

interface NewMatterFormProps {
  form: MatterForm;
  setForm: (f: MatterForm) => void;
  /** Byråns ärendetyper (org-inställning) — tom/saknad = fritext. */
  matterTypes: readonly string[] | undefined;
  /** Vald klient (visas på knappen) — null = ingen vald. */
  client: PickedClient | null;
  onPickClient: () => void;
  onClearClient: () => void;
  employeesData: { users: NamedOption[] } | undefined;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  error: { message: string } | null | undefined;
}

/** Ärendetyp: val ur byråns lista, fritext om byrån inte har någon. */
function MatterTypeField({ value, types = [], onChange }: { value: string; types: readonly string[] | undefined; onChange: (v: string) => void }) {
  const id = useId();
  if (types.length > 0) return <MatterTypeSelect value={value} types={types} onChange={onChange} />;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">Ärendetyp</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="T.ex. Familjerätt, Brottmål..." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
    </div>
  );
}

/** Nytt-ärende-formuläret (utbrutet ur MattersContent, #6-ratchet). Äger sina
 *  fält-id:n; presentational (form-state + submit som props). */
function NewMatterForm({ form, setForm, matterTypes, client, onPickClient, onClearClient, employeesData, onSubmit, isPending, error }: NewMatterFormProps) {
  const titleId = useId();
  const descriptionId = useId();
  const responsibleId = useId();
  const courtCaseNumberId = useId();
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold text-gray-900 mb-4">Nytt ärende</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={titleId} className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
          <input id={titleId} type="text" required value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <ClientField client={client} onPick={onPickClient} onClear={onClearClient} />
        <MatterTypeField value={form.matterType} types={matterTypes} onChange={(matterType) => setForm({ ...form, matterType })} />
        <div>
          <label htmlFor={responsibleId} className="block text-sm font-medium text-gray-700 mb-1">Ansvarig advokat/jurist</label>
          <select id={responsibleId} value={form.responsibleLawyerId}
            onChange={(e) => setForm({ ...form, responsibleLawyerId: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Jag själv (standard)</option>
            {employeesData?.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">Styr ärendenummerserien (juristens prefix).</p>
        </div>
        <div>
          <label htmlFor={courtCaseNumberId} className="block text-sm font-medium text-gray-700 mb-1">Målnummer</label>
          <input id={courtCaseNumberId} type="text" value={form.courtCaseNumber}
            onChange={(e) => setForm({ ...form, courtCaseNumber: e.target.value })}
            placeholder="T.ex. B 1234-26" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={descriptionId} className="block text-sm font-medium text-gray-700 mb-1">Beskrivning</label>
          <textarea id={descriptionId} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {isPending ? "Skapar..." : "Skapa ärende"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error.message}</p>}
    </form>
  );
}

/**
 * Klientfältet (#1128): "Välj klient…" öppnar sökdialogen (som jävssöket) i
 * st.f. en dropdown, som inte fungerar när byrån har många klienter.
 */
function ClientField({ client, onPick, onClear }: { client: PickedClient | null; onPick: () => void; onClear: () => void }) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">Klient</span>
      {client ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <span className="flex-1 font-medium text-gray-900">{client.name}</span>
          <button type="button" onClick={onPick} className="text-blue-600 hover:underline">Byt…</button>
          <button type="button" onClick={onClear} aria-label="Ta bort vald klient" className="text-gray-400 hover:text-gray-600">×</button>
        </div>
      ) : (
        <button type="button" onClick={onPick}
          className="w-full text-left rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-blue-400">
          Välj klient… <span className="text-gray-400">(valfritt)</span>
        </button>
      )}
    </div>
  );
}

/** Jävmärkningen (och ett fel) efter Sök/Enter (#1642). */
function MatterSearchStatus({ search }: { search: MatterSearch }) {
  return (
    <>
      {search.matchCount !== null && (
        <div className="mb-3"><ConflictMatchBadge matchCount={search.matchCount} /></div>
      )}
      {search.error && <p className="mb-3 text-sm text-red-600">{search.error.message}</p>}
    </>
  );
}

interface MattersHeaderProps {
  showForm: boolean;
  onToggleForm: () => void;
  readOnly: boolean;
  tab: MattersTab;
  onTab: (tab: MattersTab) => void;
  filters: React.ComponentProps<typeof MatterFilters>;
}

/** Sidrubriken, flikraden (#1968) och sökraden. */
function MattersHeader({ showForm, onToggleForm, readOnly, tab, onTab, filters }: MattersHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Ärenden / jävskontroll</h1>
        <button
          onClick={onToggleForm}
          disabled={readOnly}
          title={readOnly ? "Inte tillgängligt i demo-läget" : undefined}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
          {showForm ? "Avbryt" : "+ Nytt ärende"}
        </button>
      </div>
      <div className="mb-4 flex">
        <TabBar ariaLabel="Ärendelistor" tabs={MATTERS_TABS} active={tab} onSelect={onTab} />
      </div>
      <MatterFilters {...filters} />
    </>
  );
}

function MattersContent() {
  const searchParams = useSearchParams();
  const { tab, select: selectTab } = useMattersTab();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [employeeId, setEmployeeId] = useState("");
  const [page, setPage] = usePageForTab(tab);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const readOnly = useIsReadOnly();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);

  const listQuery = mattersTabQuery(tab, { search, status: statusFilter, employeeId, page });
  const t = useTRPC();
  const queryClient = useQueryClient();
  const matters = useQuery(t.matter.list.queryOptions(listQuery.args, listQuery.opts));
  const matterSearch = useMatterSearch(matters.data?.matters);

  const employees = useQuery(t.user.list.queryOptions());
  const orgSettings = useQuery(t.organization.getSettings.queryOptions());

  const createMatter = useMutation(t.matter.create.mutationOptions({
    onSuccess: () => {
      void queryClient.invalidateQueries(t.matter.list.queryFilter());
      setShowForm(false);
    },
  }));

  const [form, setForm] = useState<MatterForm>(EMPTY_MATTER_FORM);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMatter.mutate(matterCreateArgs(form));
  }

  return (
    <ListPage
      footer={<Pager data={matters.data} page={page} onPage={setPage} />}
      header={(
        <MattersHeader
          showForm={showForm}
          onToggleForm={() => setShowForm(!showForm)}
          readOnly={readOnly}
          tab={tab}
          onTab={selectTab}
          filters={{
            search,
            status: statusFilter,
            employeeId,
            employeesData: employees.data,
            onSearch: (v) => { setSearch(v); setPage(1); matterSearch.reset(); },
            onStatus: (v) => { setStatusFilter(v); setPage(1); },
            onEmployee: (v) => { setEmployeeId(v); setPage(1); },
            onSubmit: () => matterSearch.run(search),
            searching: matterSearch.searching,
            showSelects: tab === "all",
          }}
        />
      )}
    >
      {showForm && (
        <NewMatterForm
          form={form}
          setForm={setForm}
          matterTypes={orgSettings.data?.matterTypes}
          client={client}
          onPickClient={() => setPickerOpen(true)}
          onClearClient={() => { setClient(null); setForm({ ...form, klientId: "" }); }}
          employeesData={employees.data}
          onSubmit={handleSubmit}
          isPending={createMatter.isPending}
          error={createMatter.error}
        />
      )}

      {pickerOpen && (
        <ClientPickerDialog
          initialTerm={form.title.trim()}
          onPick={(c) => {
            setClient(c);
            setForm(withPickedClient(form, c));
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div role="tabpanel" aria-label={TAB_VIEW[tab].label}>
        <MatterSearchStatus search={matterSearch} />

        <DataTable
          key={tab}
          prefKey={TAB_VIEW[tab].prefKey}
          columns={matterSearch.columns}
          data={matterSearch.rows}
          rowKey={(m) => m.id}
          emptyMessage={mattersEmptyMessage(tab, search)}
        />
      </div>
    </ListPage>
  );
}

export default function MattersPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Laddar...</p>}>
      <MattersContent />
    </Suspense>
  );
}
