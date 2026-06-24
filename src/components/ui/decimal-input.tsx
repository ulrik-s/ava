"use client";

/**
 * `DecimalInput` — numeriskt fält UTAN upp/ner-spinners (#778).
 *
 * `type="number"` ritar webbläsarens spinner-pilar och visar en envis "0".
 * Det här fältet är `type="text"` med `inputMode="decimal"` (numeriskt
 * tangentbord på mobil), tomt = `null`, och tillåter komma-decimal.
 *
 * Värdet styrs av `value` men ett lokalt text-buffert låter användaren
 * skriva "12," eller radera till tomt utan att hoppa till 0. Buffern
 * synkas om föräldern ändrar `value` utifrån (t.ex. förifyllt förslag som
 * räknas om) — derived-state-from-props, ingen effect.
 */

import { useState } from "react";

interface Props {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /** Minsta tillåtna värde (lägre tolkas som tomt/ogiltigt). Default 0. */
  min?: number;
}

export function DecimalInput({ value, onChange, id, placeholder, className, min = 0 }: Props) {
  const [buf, setBuf] = useState<{ shown: number | null; text: string }>({ shown: value, text: fmt(value) });
  // Föräldern har ändrat value utifrån → adoptera det; annars behåll råtexten.
  const text = buf.shown === value ? buf.text : fmt(value);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const raw = e.target.value;
        const parsed = parseDecimal(raw, min);
        setBuf({ shown: parsed, text: raw });
        onChange(parsed);
      }}
    />
  );
}

function fmt(v: number | null): string {
  return v == null ? "" : String(v);
}

/** Text → tal eller null (tomt/ogiltigt/under min). Tillåter komma-decimal. */
export function parseDecimal(raw: string, min = 0): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}
