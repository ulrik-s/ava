"use client";

/**
 * Ärendetyp ur byråns lista (#1563). Delas av Nytt ärende och ändra-dialogen
 * i ärendehuvudet. Ett värde som inte finns i listan visas som förstavalet.
 */

import { useId } from "react";

/** Props för {@link MatterTypeSelect}. */
export interface MatterTypeSelectProps {
  /** Vald ärendetyp; `""` eller okänd typ ger förstavalet "Välj ärendetyp…". */
  value: string;
  /** Byråns ärendetyper (org-inställning). */
  types: readonly string[];
  onChange: (value: string) => void;
}

/** Rullgardinsmeny med etiketten "Ärendetyp" och byråns ärendetyper. */
export function MatterTypeSelect({ value, types, onChange }: MatterTypeSelectProps) {
  const id = useId();
  const selected = types.includes(value) ? value : "";
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">Ärendetyp</label>
      <select id={id} value={selected} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Välj ärendetyp…</option>
        {types.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
