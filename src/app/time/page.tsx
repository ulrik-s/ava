"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { trpc } from "@/client/lib/trpc";
import { formatMinutes } from "@/client/lib/utils";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'TimePage' has a complexity of 9. Maximum allowed is 8.)
export default function TimePage() {
  const [page, setPage] = useState(1);
  const timeEntries = trpc.timeEntry.list.useQuery({ page, pageSize: 50 });
  const matters = trpc.matter.list.useQuery({ pageSize: 200 });
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const matterFieldId = useId();
  const dateFieldId = useId();
  const minutesFieldId = useId();
  const descriptionFieldId = useId();
  const [form, setForm] = useState({
    matterId: "",
    date: new Date().toISOString().split("T")[0],
    minutes: 30,
    description: "",
    billable: true,
  });

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      utils.timeEntry.list.invalidate();
      setShowForm(false);
      setForm({ matterId: "", date: new Date().toISOString().split("T")[0], minutes: 30, description: "", billable: true });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tidregistrering</h1>
          {timeEntries.data && (
            <p className="text-sm text-gray-500 mt-1">Totalt: {formatMinutes(timeEntries.data.totalMinutes)}</p>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          {showForm ? "Avbryt" : "+ Registrera tid"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); createTimeEntry.mutate(form); }}
          className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor={matterFieldId} className="block text-sm text-gray-500 mb-1">Ärende *</label>
              <select id={matterFieldId} required value={form.matterId}
                onChange={(e) => setForm({ ...form, matterId: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="">Välj ärende...</option>
                {matters.data?.matters.map((m) => (
                  <option key={m.id} value={m.id}>{m.matterNumber} — {m.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={dateFieldId} className="block text-sm text-gray-500 mb-1">Datum *</label>
              <input id={dateFieldId} type="date" required value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={minutesFieldId} className="block text-sm text-gray-500 mb-1">Tid (minuter) *</label>
              <input id={minutesFieldId} type="number" required min={1} value={form.minutes}
                onChange={(e) => setForm({ ...form, minutes: parseInt(e.target.value) || 0 })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={descriptionFieldId} className="block text-sm text-gray-500 mb-1">Beskrivning *</label>
              <input id={descriptionFieldId} type="text" required value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.billable}
                onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
              Debiterbar
            </label>
            <button type="submit" disabled={createTimeEntry.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {createTimeEntry.isPending ? "Sparar..." : "Spara"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ärende</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Advokat</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tid</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deb.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {timeEntries.data?.entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-sm text-gray-500">{new Date(entry.date).toLocaleDateString("sv-SE")}</td>
                <td className="px-6 py-3">
                  <Link href={`/matters/${entry.matter.id}`} className="text-sm text-blue-600 hover:underline">
                    {entry.matter.matterNumber} — {entry.matter.title}
                  </Link>
                </td>
                <td className="px-6 py-3 text-sm text-gray-900">{entry.user.name}</td>
                <td className="px-6 py-3 text-sm font-mono text-gray-900">{formatMinutes(entry.minutes)}</td>
                <td className="px-6 py-3 text-sm text-gray-700">{entry.description}</td>
                <td className="px-6 py-3 text-sm">{entry.billable ? "Ja" : "Nej"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {timeEntries.data && timeEntries.data.pages > 1 && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">Sida {page} av {timeEntries.data.pages}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
              <button disabled={page >= timeEntries.data.pages} onClick={() => setPage(page + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
