"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pager } from "@/components/ui/pager";
import { useIsReadOnly } from "@/lib/client/demo/demo-mode-context";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";

interface MatterRow {
  id: string;
  matterNumber: string;
  title: string;
  status: string;
  isTaxeArende?: boolean;
  contacts: Array<{ contact: { name: string } }>;
  _count: { contacts: number };
}

function statusLabel(s: string): string {
  return s === "ACTIVE" ? "Aktivt" : s === "CLOSED" ? "Stängt" : "Arkiverat";
}

/**
 * Sorteringsnyckel för ärendenummer (#174). Format `<PREFIX?><YYYY>-<NNNN>`
 * → `${prefix}${year}${seq}` så prefixade och oprefixade nummer sorteras
 * stabilt (prefix-grupp, sedan år, sedan löpnummer). Okänt format faller
 * tillbaka på råsträngen.
 */
function matterNumberSortKey(matterNumber: string): string {
  const m = /^([A-ZÅÄÖ]{1,3})?(\d{4})-(\d{4})$/.exec(matterNumber);
  return m ? `${m[1] ?? ""}${m[2]}${m[3]}` : matterNumber;
}

const matterColumns: Column<MatterRow>[] = [
  { key: "matterNumber", label: "Ärendenr", sortable: true, sortValue: (m) => matterNumberSortKey(m.matterNumber),
    render: (m) => <span className="text-sm font-mono text-gray-500">{m.matterNumber}</span> },
  { key: "title", label: "Titel", sortable: true, sortValue: (m) => m.title,
    render: (m) => (
      <span>
        <EntityLink route="matters" id={m.id} className="text-sm font-medium text-blue-600 hover:underline">{m.title}</EntityLink>
        {m.isTaxeArende && (
          <span
            className="ml-2 inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            title="Taxeärende — ersättning enligt Domstolsverkets fastställda taxa">Taxa</span>
        )}
      </span>
    ),
  },
  { key: "klient", label: "Klient", sortable: true, sortValue: (m) => m.contacts[0]?.contact?.name ?? "",
    render: (m) => <span className="text-sm text-gray-500">{m.contacts[0]?.contact?.name || "—"}</span> },
  { key: "status", label: "Status", sortable: true, sortValue: (m) => statusLabel(m.status),
    render: (m) => (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        m.status === "ACTIVE" ? "bg-green-50 text-green-700"
          : m.status === "CLOSED" ? "bg-gray-100 text-gray-600"
          : "bg-yellow-50 text-yellow-700"
      }`}>{statusLabel(m.status)}</span>
    ),
  },
  { key: "contactCount", label: "Kontakter", sortable: true, align: "right", sortValue: (m) => m._count.contacts,
    render: (m) => <span className="text-sm text-gray-500">{m._count.contacts}</span> },
];

type StatusFilter = "ACTIVE" | "CLOSED" | "ARCHIVED" | "";
type NamedOption = { id: string; name: string };

interface MatterForm {
  title: string;
  description: string;
  matterType: string;
  klientId: string;
  responsibleLawyerId: string;
  courtCaseNumber: string;
  isTaxeArende: boolean;
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
  contactsData: { contacts: NamedOption[] } | undefined;
  employeesData: { users: NamedOption[] } | undefined;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  error: { message: string } | null | undefined;
}

/** Nytt-ärende-formuläret (utbrutet ur MattersContent, #6-ratchet). Äger sina
 *  fält-id:n; presentational (form-state + submit som props). */
function NewMatterForm({ form, setForm, contactsData, employeesData, onSubmit, isPending, error }: NewMatterFormProps) {
  const titleId = useId();
  const klientId = useId();
  const matterTypeId = useId();
  const descriptionId = useId();
  const responsibleId = useId();
  const courtCaseId = useId();
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
        <div>
          <label htmlFor={klientId} className="block text-sm font-medium text-gray-700 mb-1">Klient</label>
          <select id={klientId} value={form.klientId}
            onChange={(e) => setForm({ ...form, klientId: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Välj klient (valfritt)...</option>
            {contactsData?.contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={matterTypeId} className="block text-sm font-medium text-gray-700 mb-1">Ärendetyp</label>
          <input id={matterTypeId} type="text" value={form.matterType}
            onChange={(e) => setForm({ ...form, matterType: e.target.value })}
            placeholder="T.ex. Familjerätt, Brottmål..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
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
          <label htmlFor={courtCaseId} className="block text-sm font-medium text-gray-700 mb-1">Domstolens målnummer</label>
          <input id={courtCaseId} type="text" value={form.courtCaseNumber}
            onChange={(e) => setForm({ ...form, courtCaseNumber: e.target.value })}
            placeholder="t.ex. B 1234-26 (valfritt)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" />
          <p className="mt-1 text-xs text-gray-500">Matchningsnyckel för domstolsbetalningar (#173).</p>
        </div>
        <div className="md:col-span-2">
          <label htmlFor={descriptionId} className="block text-sm font-medium text-gray-700 mb-1">Beskrivning</label>
          <textarea id={descriptionId} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="md:col-span-2">
          <label className="inline-flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.isTaxeArende}
              onChange={(e) => setForm({ ...form, isTaxeArende: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-gray-900">Taxeärende</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Ersättning enligt Domstolsverkets fastställda taxa (schablon)
                istället för löpande timdebitering. Vanligast för brottmål med
                offentlig försvarare, konkursförvaltning och förordnandemål.
              </span>
            </span>
          </label>
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

interface MatterFiltersProps {
  search: string;
  status: StatusFilter;
  employeeId: string;
  employeesData: { users: NamedOption[] } | undefined;
  onSearch: (v: string) => void;
  onStatus: (v: StatusFilter) => void;
  onEmployee: (v: string) => void;
}

/** Sök- + status- + medarbetar-filter (utbrutet ur MattersContent, #6-ratchet). */
function MatterFilters({ search, status, employeeId, employeesData, onSearch, onStatus, onEmployee }: MatterFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
      <input type="text" placeholder="Sök ärenden..." value={search}
        onChange={(e) => onSearch(e.target.value)}
        className="flex-1 sm:max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <select value={status}
        onChange={(e) => onStatus(e.target.value as StatusFilter)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Alla statusar</option>
        <option value="ACTIVE">Aktiva</option>
        <option value="CLOSED">Stängda</option>
        <option value="ARCHIVED">Arkiverade</option>
      </select>
      <select value={employeeId}
        onChange={(e) => onEmployee(e.target.value)}
        title="Visa ärenden som medarbetaren har arbetat på (har tidsposter på)"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Alla medarbetare</option>
        {employeesData?.users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </div>
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

  const matters = trpc.matter.list.useQuery(matterListArgs({ search, status: statusFilter, employeeId, page }));

  const contacts = trpc.contacts.list.useQuery({ pageSize: 100 });
  const employees = trpc.user.list.useQuery();
  const utils = trpc.useUtils();

  const createMatter = trpc.matter.create.useMutation({
    onSuccess: () => {
      void utils.matter.list.invalidate();
      setShowForm(false);
    },
  });

  const [form, setForm] = useState<MatterForm>({
    title: "",
    description: "",
    matterType: "",
    klientId: "",
    responsibleLawyerId: "",
    courtCaseNumber: "",
    isTaxeArende: false,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMatter.mutate({
      title: form.title,
      description: form.description || undefined,
      matterType: form.matterType || undefined,
      klientId: form.klientId || undefined,
      responsibleLawyerId: form.responsibleLawyerId || undefined,
      courtCaseNumber: form.courtCaseNumber || undefined,
      isTaxeArende: form.isTaxeArende || undefined,
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ärenden</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={readOnly}
          title={readOnly ? "Inte tillgängligt i demo-läget" : undefined}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
          {showForm ? "Avbryt" : "+ Nytt ärende"}
        </button>
      </div>

      {showForm && (
        <NewMatterForm
          form={form}
          setForm={setForm}
          contactsData={contacts.data}
          employeesData={employees.data}
          onSubmit={handleSubmit}
          isPending={createMatter.isPending}
          error={createMatter.error}
        />
      )}

      <MatterFilters
        search={search}
        status={statusFilter}
        employeeId={employeeId}
        employeesData={employees.data}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        onStatus={(v) => { setStatusFilter(v); setPage(1); }}
        onEmployee={(v) => { setEmployeeId(v); setPage(1); }}
      />

      <DataTable
        prefKey="list.matters"
        columns={matterColumns}
        data={(matters.data?.matters ?? []) as MatterRow[]}
        rowKey={(m) => m.id}
        emptyMessage="Inga ärenden."
      />
      <Pager data={matters.data} page={page} onPage={setPage} />
    </div>
  );
}

export default function MattersPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Laddar...</p>}>
      <MattersContent />
    </Suspense>
  );
}
