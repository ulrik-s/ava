"use client";

import { Suspense, useId, useState } from "react";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/client/trpc";
import { useIsReadOnly } from "@/lib/client/demo/demo-mode-context";
import { DataTable, type Column } from "@/components/ui/data-table";

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

const matterColumns: Column<MatterRow>[] = [
  { key: "matterNumber", label: "Ärendenr", sortable: true, sortValue: (m) => m.matterNumber,
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

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'MattersContent' has a complexity of 11. Maximum allowed is 8.)
function MattersContent() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "CLOSED" | "ARCHIVED" | "">("");
  const [employeeId, setEmployeeId] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const readOnly = useIsReadOnly();
  const titleId = useId();
  const klientId = useId();
  const matterTypeId = useId();
  const descriptionId = useId();

  const matters = trpc.matter.list.useQuery({
    search,
    status: statusFilter || undefined,
    employeeId: employeeId || undefined,
    page,
    pageSize: 20,
  });

  const contacts = trpc.contacts.list.useQuery({ pageSize: 100 });
  const employees = trpc.user.list.useQuery();
  const utils = trpc.useUtils();

  const createMatter = trpc.matter.create.useMutation({
    onSuccess: () => {
      void utils.matter.list.invalidate();
      setShowForm(false);
    },
  });

  const [form, setForm] = useState({
    title: "",
    description: "",
    matterType: "",
    klientId: "",
    isTaxeArende: false,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMatter.mutate({
      title: form.title,
      description: form.description || undefined,
      matterType: form.matterType || undefined,
      klientId: form.klientId || undefined,
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
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
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
                {contacts.data?.contacts.map((c) => (
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
            <button type="submit" disabled={createMatter.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {createMatter.isPending ? "Skapar..." : "Skapa ärende"}
            </button>
          </div>
          {createMatter.error && <p className="mt-2 text-sm text-red-600">{createMatter.error.message}</p>}
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
        <input type="text" placeholder="Sök ärenden..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 sm:max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Alla statusar</option>
          <option value="ACTIVE">Aktiva</option>
          <option value="CLOSED">Stängda</option>
          <option value="ARCHIVED">Arkiverade</option>
        </select>
        <select value={employeeId}
          onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}
          title="Visa ärenden som medarbetaren har arbetat på (har tidsposter på)"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Alla medarbetare</option>
          {employees.data?.users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>

      <DataTable
        prefKey="list.matters"
        columns={matterColumns}
        data={(matters.data?.matters ?? []) as MatterRow[]}
        rowKey={(m) => m.id}
        emptyMessage="Inga ärenden."
      />
      {matters.data && matters.data.pages > 1 && (
        <div className="px-6 py-3 mt-2 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-gray-500">Sida {page} av {matters.data.pages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
            <button disabled={page >= matters.data.pages} onClick={() => setPage(page + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
          </div>
        </div>
      )}
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
