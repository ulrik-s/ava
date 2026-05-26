"use client";

/**
 * `CheckboxList` — kompakt multi-select med checkboxar i scrollbar list.
 * Används för att bjuda in kollegor och kontakter till kalender-event.
 *
 * Designval: native checkboxes i en list = bra på touch, tillgängligt,
 * inget extra dependency. Filterbart inputfält ovanför.
 */

import { useId, useState } from "react";

export interface CheckboxOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: CheckboxOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  placeholder?: string;
  emptyMessage?: string;
}

export function CheckboxList({ options, selectedIds, onChange, label, placeholder, emptyMessage }: Props) {
  const filterId = useId();
  const [filter, setFilter] = useState("");

  const filtered = filter.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(filter.toLowerCase())
        || (o.sublabel?.toLowerCase().includes(filter.toLowerCase()) ?? false))
    : options;

  function toggle(id: string): void {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div>
      {label && <label htmlFor={filterId} className="block text-xs text-gray-600 mb-1">{label}</label>}
      <input
        id={filterId}
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={placeholder ?? "Sök…"}
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs mb-1"
      />
      <div className="border border-gray-200 rounded max-h-40 overflow-y-auto bg-white">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">{emptyMessage ?? "Inga matchningar."}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="flex-1">
                    <span className="text-gray-900">{o.label}</span>
                    {o.sublabel && <span className="text-gray-400 ml-1">· {o.sublabel}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-[11px] text-gray-500 mt-1">{selectedIds.length} markerade</p>
      )}
    </div>
  );
}
