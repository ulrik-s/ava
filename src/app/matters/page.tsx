"use client";

import { Suspense, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/client/lib/trpc";
import { useIsReadOnly } from "@/client/lib/demo/demo-mode-context";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'MattersContent' has a complexity of 11. Maximum allowed is 8.)
function MattersContent() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "CLOSED" | "ARCHIVED" | "">("");
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
    page,
    pageSize: 20,
  });

  const contacts = trpc.contacts.list.useQuery({ pageSize: 100 });
  const utils = trpc.useUtils();

  const createMatter = trpc.matter.create.useMutation({
    onSuccess: () => {
      utils.matter.list.invalidate();
      setShowForm(false);
    },
  });

  const [form, setForm] = useState({
    title: "",
    description: "",
    matterType: "",
    klientId: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMatter.mutate({
      title: form.title,
      description: form.description || undefined,
      matterType: form.matterType || undefined,
      klientId: form.klientId || undefined,
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
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ärendenr</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titel</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Klient</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kontakter</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {matters.data?.matters.map((matter) => {
              const klient = matter.contacts[0]?.contact.name;
              return (
                <tr key={matter.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-500">{matter.matterNumber}</td>
                  <td className="px-6 py-4">
                    <Link href={`/matters/${matter.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                      {matter.title}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{klient || "—"}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      matter.status === "ACTIVE" ? "bg-green-50 text-green-700"
                        : matter.status === "CLOSED" ? "bg-gray-100 text-gray-600"
                        : "bg-yellow-50 text-yellow-700"
                    }`}>
                      {matter.status === "ACTIVE" ? "Aktivt" : matter.status === "CLOSED" ? "Stängt" : "Arkiverat"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{matter._count.contacts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {matters.data && matters.data.pages > 1 && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">Sida {page} av {matters.data.pages}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
              <button disabled={page >= matters.data.pages} onClick={() => setPage(page + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
            </div>
          </div>
        )}
      </div>
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
