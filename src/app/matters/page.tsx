"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { ClientPickerDialog } from "@/components/contacts/client-picker-dialog";
import type { PickedClient } from "@/components/contacts/new-client-dialog";
import { ListPage } from "@/components/layout/list-page";
import { ConflictMatchBadge } from "@/components/matter/conflict-match-badge";
import { MatterTypeSelect } from "@/components/matter/matter-type-select";
import { DataTable } from "@/components/ui/data-table";
import { Pager } from "@/components/ui/pager";
import { useIsReadOnly } from "@/lib/client/demo/demo-mode-context";
import { trpc } from "@/lib/client/trpc";
import { MatterFilters, type NamedOption, type StatusFilter } from "./_matter-filters";
import { type MatterSearch, useMatterSearch } from "./_use-matter-search";

interface MatterForm {
  title: string;
  description: string;
  matterType: string;
  klientId: string;
  responsibleLawyerId: string;
  /** Domstolens målnummer — frivilligt, trimmas vid submit (#1509). */
  courtCaseNumber: string;
}

/** Trimmat värde, eller undefined när det bara är blanksteg/tomt. */
function optionalTrimmed(v: string): string | undefined {
  return v.trim() || undefined;
}

const EMPTY_MATTER_FORM: MatterForm = {
  title: "",
  description: "",
  matterType: "",
  klientId: "",
  responsibleLawyerId: "",
  courtCaseNumber: "",
};

/** Formulär → `matter.create`-input: tomma fält utelämnas (utbrutet ur
 *  MattersContent, max-lines/complexity-ratchet). */
function matterCreateArgs(form: MatterForm) {
  return {
    title: form.title,
    description: form.description || undefined,
    matterType: form.matterType || undefined,
    klientId: form.klientId || undefined,
    responsibleLawyerId: form.responsibleLawyerId || undefined,
    courtCaseNumber: optionalTrimmed(form.courtCaseNumber),
  };
}

/** Bygg query-args för matter.list (flyttar `|| undefined`-grenarna ut ur
 *  MattersContent → håller den under complexity@8). */
function matterListArgs(p: { search: string; status: StatusFilter; employeeId: string; page: number }) {
  return {
    search: p.search,
    status: p.status || undefined,
    employeeId: p.employeeId || undefined,
    page: p.page,
    pageSize: 20,
  };
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

function MattersContent() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [employeeId, setEmployeeId] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const readOnly = useIsReadOnly();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);

  const matters = trpc.matter.list.useQuery(matterListArgs({ search, status: statusFilter, employeeId, page }));
  const matterSearch = useMatterSearch(matters.data?.matters);

  const employees = trpc.user.list.useQuery();
  const orgSettings = trpc.organization.getSettings.useQuery();
  const utils = trpc.useUtils();

  const createMatter = trpc.matter.create.useMutation({
    onSuccess: () => {
      void utils.matter.list.invalidate();
      setShowForm(false);
    },
  });

  const [form, setForm] = useState<MatterForm>(EMPTY_MATTER_FORM);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMatter.mutate(matterCreateArgs(form));
  }

  return (
    <ListPage
      footer={<Pager data={matters.data} page={page} onPage={setPage} />}
      header={(
        <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Ärenden</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={readOnly}
          title={readOnly ? "Inte tillgängligt i demo-läget" : undefined}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
          {showForm ? "Avbryt" : "+ Nytt ärende"}
        </button>
      </div>
      <MatterFilters
        search={search}
        status={statusFilter}
        employeeId={employeeId}
        employeesData={employees.data}
        onSearch={(v) => { setSearch(v); setPage(1); matterSearch.reset(); }}
        onStatus={(v) => { setStatusFilter(v); setPage(1); }}
        onEmployee={(v) => { setEmployeeId(v); setPage(1); }}
        onSubmit={() => matterSearch.run(search)}
        searching={matterSearch.searching}
      />
        </>
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
          onPick={(c) => {
            setClient(c);
            setForm({ ...form, klientId: c.id });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <MatterSearchStatus search={matterSearch} />

      <DataTable
        prefKey="list.matters"
        columns={matterSearch.columns}
        data={matterSearch.rows}
        rowKey={(m) => m.id}
        emptyMessage="Inga ärenden."
      />
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
