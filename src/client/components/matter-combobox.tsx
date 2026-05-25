"use client";

/**
 * `MatterCombobox` — sökbar val-input för ärenden. Använder befintliga
 * `<datalist>` istället för en custom dropdown — funkar på mobil,
 * keyboard-accessible, inga extra dependencies.
 *
 * Användning:
 *   <MatterCombobox matters={list} value={matterId} onChange={setMatterId} />
 *
 * Visar "<matterNumber> — <title>" i lista. Användaren kan söka på båda.
 * Bra för advokater med 100+ ärenden — slipper scrolla en lång dropdown.
 */

import { useId, useMemo } from "react";

export interface MatterOption {
  id: string;
  matterNumber: string;
  title: string;
}

interface Props {
  matters: MatterOption[];
  value: string;
  onChange: (matterId: string) => void;
  required?: boolean;
  placeholder?: string;
  label?: string;
}

export function MatterCombobox({ matters, value, onChange, required, placeholder, label }: Props): React.ReactElement {
  const inputId = useId();
  const listId = useId();

  // Sortera på matterNumber så snabbnumrerat-val (skriv "2026-0001") fungerar.
  const options = useMemo(
    () => [...matters].sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv")),
    [matters],
  );

  // Bygg map id→display så vi kan visa nuvarande val även om input innehåller
  // användarens sökterm.
  const display = useMemo(() => {
    const m = options.find((o) => o.id === value);
    return m ? `${m.matterNumber} — ${m.title}` : "";
  }, [options, value]);

  return (
    <div>
      {label && <label htmlFor={inputId} className="block text-sm text-gray-500 mb-1">{label}</label>}
      <input
        id={inputId}
        list={listId}
        required={required}
        value={display}
        onChange={(e) => {
          const v = e.target.value;
          // Hitta option som matchar typad/vald sträng
          const m = options.find((o) => `${o.matterNumber} — ${o.title}` === v);
          if (m) onChange(m.id);
          else onChange("");
        }}
        placeholder={placeholder ?? "Sök på ärendenr eller titel..."}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((m) => (
          <option key={m.id} value={`${m.matterNumber} — ${m.title}`} />
        ))}
      </datalist>
    </div>
  );
}
