"use client";

import { useState } from "react";
import { trpc } from "@/client/lib/trpc";
import { formatMinutes } from "@/client/lib/utils";

interface Props {
  matterId: string;
}

export function TimeSection({ matterId }: Props) {
  const utils = trpc.useUtils();
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  const [showTimeForm, setShowTimeForm] = useState(false);
  const [timeForm, setTimeForm] = useState({
    date: new Date().toISOString().split("T")[0],
    minutes: 30,
    description: "",
    billable: true,
  });

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      utils.timeEntry.list.invalidate({ matterId });
      setShowTimeForm(false);
      setTimeForm({
        date: new Date().toISOString().split("T")[0],
        minutes: 30,
        description: "",
        billable: true,
      });
    },
  });

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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {timeEntries.data?.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-6 py-2 text-sm text-gray-500">{new Date(entry.date).toLocaleDateString("sv-SE")}</td>
                <td className="px-6 py-2 text-sm text-gray-900">{entry.user.name}</td>
                <td className="px-6 py-2 text-sm text-gray-900">{formatMinutes(entry.minutes)}</td>
                <td className="px-6 py-2 text-sm text-gray-700">{entry.description}</td>
                <td className="px-6 py-2 text-sm">{entry.billable ? "Ja" : "Nej"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
