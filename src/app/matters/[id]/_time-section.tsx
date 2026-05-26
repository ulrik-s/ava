"use client";

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";

interface Props {
  matterId: string;
  isTaxeArende?: boolean;
}

interface EditForm {
  date: string;
  minutes: number;
  description: string;
  billable: boolean;
}

 
export function TimeSection({ matterId, isTaxeArende }: Props) {
  const utils = trpc.useUtils();
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  const [showTimeForm, setShowTimeForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [timeForm, setTimeForm] = useState<EditForm>({
    date: new Date().toISOString().split("T")[0],
    minutes: 30,
    description: "",
    billable: true,
  });

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      utils.timeEntry.list.invalidate({ matterId });
      setShowTimeForm(false);
      setTimeForm({ date: new Date().toISOString().split("T")[0], minutes: 30, description: "", billable: true });
    },
  });

  const updateTimeEntry = trpc.timeEntry.update.useMutation({
    onSuccess: () => {
      utils.timeEntry.list.invalidate({ matterId });
      setEditingId(null);
      setEditForm(null);
    },
  });

  const deleteTimeEntry = trpc.timeEntry.delete.useMutation({
    onSuccess: () => utils.timeEntry.list.invalidate({ matterId }),
  });

  function startEdit(entry: { id: string; date: Date | string; minutes: number; description: string | null; billable: boolean }): void {
    setEditingId(entry.id);
    setEditForm({
      date: new Date(entry.date).toISOString().split("T")[0],
      minutes: entry.minutes,
      description: entry.description ?? "",
      billable: entry.billable,
    });
  }

  function saveEdit(): void {
    if (!editingId || !editForm) return;
    updateTimeEntry.mutate({ id: editingId, ...editForm });
  }

  function confirmDelete(id: string): void {
    if (confirm("Ta bort tidregistreringen?")) deleteTimeEntry.mutate({ id });
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          Tidregistrering
          {timeEntries.data && (
            <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatMinutes(timeEntries.data.totalMinutes)})</span>
          )}
        </h2>
        <button onClick={() => setShowTimeForm(!showTimeForm)} className="text-sm text-blue-600 hover:underline">
          {showTimeForm ? "Avbryt" : "+ Registrera tid"}
        </button>
      </div>

      {showTimeForm && (
        <form onSubmit={(e) => { e.preventDefault(); createTimeEntry.mutate({ ...timeForm, matterId }); }}
          className="p-4 border-b border-gray-200">
          {isTaxeArende && (
            <div className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-3 py-2 mb-3">
              <strong>Taxeärende</strong> — arvodet ersätts enligt Domstolsverkets
              fastställda taxa (brottmålstaxan / motsv.), inte byråns timpris.
              Registrera ändå faktisk nedlagd tid — domstolen kan frångå taxan
              om &quot;avsevärt mer arbete än normalt&quot; krävts.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="date" required value={timeForm.date}
              onChange={(e) => setTimeForm({ ...timeForm, date: e.target.value })}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
            <div className="flex items-center gap-2">
              <input type="number" required min={1} value={timeForm.minutes}
                onChange={(e) => setTimeForm({ ...timeForm, minutes: parseInt(e.target.value) || 0 })}
                className="w-20 rounded border border-gray-300 px-3 py-1.5 text-sm" />
              <span className="text-sm text-gray-500">min</span>
            </div>
            <input type="text" required placeholder="Beskrivning *" value={timeForm.description}
              onChange={(e) => setTimeForm({ ...timeForm, description: e.target.value })}
              className="md:col-span-2 rounded border border-gray-300 px-3 py-1.5 text-sm" />
          </div>
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={timeForm.billable}
                onChange={(e) => setTimeForm({ ...timeForm, billable: e.target.checked })} />
              Debiterbar
            </label>
            <button type="submit" disabled={createTimeEntry.isPending}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {createTimeEntry.isPending ? "Sparar..." : "Spara"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Advokat</th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tid</th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Beskrivning</th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deb.</th>
              <th className="px-6 py-2 text-right text-xs font-medium text-gray-500 uppercase"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* eslint-disable-next-line complexity */}
            {timeEntries.data?.entries.map((entry) => (
              editingId === entry.id && editForm ? (
                <tr key={entry.id} className="bg-blue-50/30">
                  <td className="px-6 py-2">
                    <input type="date" value={editForm.date}
                      onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                      className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  </td>
                  <td className="px-6 py-2 text-sm text-gray-500">{entry.user?.name ?? "—"}</td>
                  <td className="px-6 py-2">
                    <input type="number" min={1} value={editForm.minutes}
                      onChange={(e) => setEditForm({ ...editForm, minutes: parseInt(e.target.value) || 0 })}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
                  </td>
                  <td className="px-6 py-2">
                    <input type="text" value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                  </td>
                  <td className="px-6 py-2 text-sm">
                    <input type="checkbox" checked={editForm.billable}
                      onChange={(e) => setEditForm({ ...editForm, billable: e.target.checked })} />
                  </td>
                  <td className="px-6 py-2 text-right whitespace-nowrap">
                    <button onClick={saveEdit} disabled={updateTimeEntry.isPending}
                      className="text-xs text-blue-600 hover:underline mr-3 disabled:opacity-50">
                      {updateTimeEntry.isPending ? "Sparar..." : "Spara"}
                    </button>
                    <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-xs text-gray-500 hover:underline">
                      Avbryt
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={entry.id}>
                  <td className="px-6 py-2 text-sm text-gray-500">{new Date(entry.date).toLocaleDateString("sv-SE")}</td>
                  <td className="px-6 py-2 text-sm text-gray-900">{entry.user?.name ?? "—"}</td>
                  <td className="px-6 py-2 text-sm text-gray-900">{formatMinutes(entry.minutes)}</td>
                  <td className="px-6 py-2 text-sm text-gray-700">{entry.description}</td>
                  <td className="px-6 py-2 text-sm">{entry.billable ? "Ja" : "Nej"}</td>
                  <td className="px-6 py-2 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(entry)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">
                      Ändra
                    </button>
                    <button onClick={() => confirmDelete(entry.id)} className="text-xs text-red-500 hover:underline">
                      Ta bort
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
