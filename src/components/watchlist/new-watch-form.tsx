"use client";

import { useId, useState } from "react";
import { useCreateWatch } from "./use-watch-actions";

/**
 * Ny bevakning utan ärende (#1167) — t.ex. en egen påminnelse. Bevakningar i
 * ett ärende läggs in i ärendets "Att bevaka". En bevakning har alltid ett datum.
 */
export function NewWatchForm() {
  const titleId = useId();
  const dateId = useId();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const { create, pending } = useCreateWatch(() => { setTitle(""); setDate(""); });
  return (
    <form onSubmit={(e) => { e.preventDefault(); create(title, date); }}
      className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex-1 min-w-[12rem]">
        <label htmlFor={titleId} className="block text-xs font-medium text-gray-500 mb-1">Ny bevakning</label>
        <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="t.ex. Ring klienten om förlikningsbud"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label htmlFor={dateId} className="block text-xs font-medium text-gray-500 mb-1">Bevakningsdatum</label>
        <input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={!title.trim() || !date || pending}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
        Lägg till
      </button>
    </form>
  );
}
