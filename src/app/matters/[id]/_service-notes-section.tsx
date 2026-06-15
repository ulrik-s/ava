"use client";

/**
 * Tjänsteanteckningar (#348) — panel i ärendet. Korta, daterade noteringar
 * (datum + tid + text + författare). Append-only i v1.
 */

import { NotebookPen } from "lucide-react";
import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { trpc } from "@/lib/client/trpc";

interface ServiceNote {
  id: string;
  date: string;
  time: string;
  text: string;
  author?: { name?: string | null } | null;
}

function nowParts(): { date: string; time: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Fallande sortering på notens egna datum+tid (senaste först). */
function byDateTimeDesc(a: ServiceNote, b: ServiceNote): number {
  return `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`);
}

function authorName(n: ServiceNote): string {
  return n.author?.name ?? "—";
}

/** Kolumnerna för tjänsteanteckningstabellen — en rad per anteckning, alla
 *  sorterbara/filterbara precis som övriga AVA-tabeller (#367). */
function noteColumns(): Column<ServiceNote>[] {
  return [
    { key: "date", label: "Datum", sortable: true, filterable: true,
      sortValue: (n) => n.date, filterValue: (n) => n.date,
      render: (n) => <span className="text-sm text-gray-500 whitespace-nowrap">{n.date}</span> },
    { key: "time", label: "Tid", sortable: true, filterable: true,
      sortValue: (n) => n.time, filterValue: (n) => n.time,
      render: (n) => <span className="text-sm text-gray-500 whitespace-nowrap">{n.time}</span> },
    { key: "author", label: "Författare", sortable: true, filterable: true, groupable: true,
      sortValue: authorName, filterValue: authorName, groupValue: authorName,
      render: (n) => <span className="text-sm text-gray-900 whitespace-nowrap">{authorName(n)}</span> },
    { key: "text", label: "Anteckning", sortable: true, filterable: true,
      sortValue: (n) => n.text, filterValue: (n) => n.text,
      render: (n) => <span className="text-sm text-gray-800 whitespace-pre-wrap">{n.text}</span> },
  ];
}

export function ServiceNotesSection({ matterId }: { matterId: string }) {
  const utils = trpc.useUtils();
  const notes = trpc.serviceNote.list.useQuery({ matterId });
  const [adding, setAdding] = useState(false);

  const items = ((notes.data ?? []) as ServiceNote[]).slice().sort(byDateTimeDesc);

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <NotebookPen size={16} /> Tjänsteanteckningar
        </h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:underline">
            + Ny anteckning
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {adding && (
          <NoteForm
            matterId={matterId}
            onDone={() => { setAdding(false); void utils.serviceNote.list.invalidate({ matterId }); }}
            onCancel={() => setAdding(false)}
          />
        )}

        {notes.isLoading ? (
          <p className="text-sm text-gray-500">Laddar…</p>
        ) : (
          <DataTable
            prefKey={`list.matter-service-notes.${matterId}`}
            columns={noteColumns()}
            data={items}
            rowKey={(n) => n.id}
            emptyMessage="Inga tjänsteanteckningar ännu."
          />
        )}
      </div>
    </div>
  );
}

function NoteForm({ matterId, onDone, onCancel }: { matterId: string; onDone: () => void; onCancel: () => void }) {
  const init = nowParts();
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [text, setText] = useState("");
  const create = trpc.serviceNote.create.useMutation({ onSuccess: onDone });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!text.trim()) return;
    create.mutate({ matterId, date, time, text: text.trim() });
  }

  return (
    <form onSubmit={submit} className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Datum *</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 mb-1 block">Tid *</span>
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-600 mb-1 block">Anteckning *</span>
        <textarea required value={text} onChange={(e) => setText(e.target.value)} rows={3}
          placeholder="Vad hände? (samtal, åtgärd, övervägande…)"
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-white">Avbryt</button>
        <button type="submit" disabled={!text.trim() || create.isPending}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {create.isPending ? "Sparar…" : "Spara"}
        </button>
      </div>
    </form>
  );
}
