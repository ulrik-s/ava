"use client";

/**
 * `MatterCombobox` — sökbar val-input för ärenden via native `<datalist>`.
 *
 * Designval (Single responsibility):
 *   - Bara presentation: en input + en datalist. State för "vad användaren
 *     skriver" lever inuti komponenten; parenten ser bara id:t via onChange.
 *
 * Designval (Open-closed):
 *   - Utbytbart UI utan att kallaren behöver bry sig. Implementationen kan
 *     bytas mot t.ex. Headless UI Combobox utan att ändra props-kontraktet.
 *
 * Beteende:
 *   1. Användaren ser texten hen skriver direkt (lokalt state).
 *   2. När typen matchar en option exakt → onChange(matterId).
 *   3. När input töms → onChange("").
 *   4. När value-prop sätts utifrån → display:n hoppar till matter-namnet.
 */

import { useEffect, useId, useMemo, useState } from "react";

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

  const options = useMemo(
    () => [...matters].sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv")),
    [matters],
  );

  function labelFor(o: MatterOption): string {
    return `${o.matterNumber} — ${o.title}`;
  }

  const [text, setText] = useState<string>(() => {
    const m = options.find((o) => o.id === value);
    return m ? labelFor(m) : "";
  });

  // Synka in display-text när value-prop ändras utifrån (formulär-reset,
  // edit-flöde där matterId sätts efter mount). Vi ändrar text BARA om
  // det skiljer från nuvarande text — annars stör vi användaren mitt i
  // skrivningen.
  useEffect(() => {
    const m = options.find((o) => o.id === value);
    const next = m ? labelFor(m) : "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText((curr) => (curr === next ? curr : next));
  }, [value, options]);

  function handleInput(v: string): void {
    setText(v);
    const exactMatch = options.find((o) => labelFor(o) === v);
    if (exactMatch) onChange(exactMatch.id);
    else if (v === "") onChange("");
    // Partiell match → låt onChange vara orörd så formuläret kvarstår i
    // "inget vald än"-läge tills användaren plockar en option.
  }

  return (
    <div>
      {label && <label htmlFor={inputId} className="block text-sm text-gray-500 mb-1">{label}</label>}
      <input
        id={inputId}
        list={listId}
        required={required}
        value={text}
        onChange={(e) => handleInput(e.target.value)}
        placeholder={placeholder ?? "Sök på ärendenr eller titel..."}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((m) => (
          <option key={m.id} value={labelFor(m)} />
        ))}
      </datalist>
    </div>
  );
}
