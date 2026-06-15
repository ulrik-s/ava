"use client";

/**
 * Tjänsteanteckningar (#348) — panel i ärendet. Korta, daterade noteringar
 * (datum + tid + text + författare). Append-only i v1.
 */

import { NotebookPen } from "lucide-react";
import { useState } from "react";
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
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Inga tjänsteanteckningar ännu.</p>
        ) : (
          <NoteList items={items} />
        )}
      </div>
    </div>
  );
}

function NoteList({ items }: { items: ServiceNote[] }) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((n) => (
        <li key={n.id} className="py-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>
              {n.date} {n.time}
              <span className="ml-2 text-gray-400">· {n.author?.name ?? "—"}</span>
            </span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.text}</p>
        </li>
      ))}
    </ul>
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
