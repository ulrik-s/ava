"use client";

/**
 * Tjänsteanteckningar (#348) — panel i ärendet. Korta, daterade noteringar
 * (datum + tid + text + författare). Redigerbara/raderbara (#375).
 */

import { NotebookPen, Pencil, Trash2 } from "lucide-react";
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
 *  sorterbara/filterbara precis som övriga AVA-tabeller (#367). Anteckning-
 *  kolumnen wrappar lång text + en actions-kolumn med redigera/ta-bort (#375). */
function noteColumns(opts: { onEdit: (n: ServiceNote) => void; onDelete: (id: string) => void }): Column<ServiceNote>[] {
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
    { key: "text", label: "Anteckning", sortable: true, filterable: true, wrap: true, defaultWidth: 380,
      sortValue: (n) => n.text, filterValue: (n) => n.text,
      render: (n) => <span className="text-sm text-gray-800 whitespace-pre-wrap break-words">{n.text}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (n) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <button type="button" onClick={() => opts.onEdit(n)} title="Redigera"
            className="text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
          <button type="button" onClick={() => opts.onDelete(n.id)} title="Ta bort"
            className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      ) },
  ];
}

/** Initialvärden för formuläret: redigerad nots fält, annars nu + tom text. */
function initialValues(initial?: ServiceNote | null): { date: string; time: string; text: string } {
  if (initial) return { date: initial.date, time: initial.time, text: initial.text };
  const n = nowParts();
  return { date: n.date, time: n.time, text: "" };
}

export function ServiceNotesSection({ matterId }: { matterId: string }) {
  const utils = trpc.useUtils();
  const notes = trpc.serviceNote.list.useQuery({ matterId });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ServiceNote | null>(null);
  const del = trpc.serviceNote.delete.useMutation({
    onSuccess: () => void utils.serviceNote.list.invalidate({ matterId }),
  });

  const close = (): void => { setAdding(false); setEditing(null); };
  const refresh = (): void => { close(); void utils.serviceNote.list.invalidate({ matterId }); };
  const showForm = adding || editing !== null;

  const items = ((notes.data ?? []) as ServiceNote[]).slice().sort(byDateTimeDesc);
  const columns = noteColumns({
    onEdit: (n) => { setAdding(false); setEditing(n); },
    onDelete: (id) => { if (confirm("Ta bort tjänsteanteckningen?")) del.mutate({ id }); },
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <NotebookPen size={16} /> Tjänsteanteckningar
        </h2>
        {!showForm && (
          <button onClick={() => { setEditing(null); setAdding(true); }} className="text-sm text-blue-600 hover:underline">
            + Ny anteckning
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {showForm && (
          <NoteForm matterId={matterId} initial={editing} onDone={refresh} onCancel={close} />
        )}

        {notes.isLoading ? (
          <p className="text-sm text-gray-500">Laddar…</p>
        ) : (
          <DataTable
            prefKey={`list.matter-service-notes.${matterId}`}
            columns={columns}
            data={items}
            rowKey={(n) => n.id}
            emptyMessage="Inga tjänsteanteckningar ännu."
          />
        )}
      </div>
    </div>
  );
}

function NoteForm({ matterId, initial, onDone, onCancel }: {
  matterId: string; initial?: ServiceNote | null; onDone: () => void; onCancel: () => void;
}) {
  const start = initialValues(initial);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [text, setText] = useState(start.text);
  const create = trpc.serviceNote.create.useMutation({ onSuccess: onDone });
  const update = trpc.serviceNote.update.useMutation({ onSuccess: onDone });
  const pending = create.isPending || update.isPending;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!text.trim()) return;
    if (initial) update.mutate({ id: initial.id, date, time, text: text.trim() });
    else create.mutate({ matterId, date, time, text: text.trim() });
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
        <button type="submit" disabled={!text.trim() || pending}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {pending ? "Sparar…" : "Spara"}
        </button>
      </div>
    </form>
  );
}
