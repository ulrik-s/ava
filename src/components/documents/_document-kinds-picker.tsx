"use client";

/**
 * Val av dokumentets typer (ADR 0038) i "Redigera uppgifter…": de inbyggda
 * typerna, byråns egna typer och de typer dokumentet redan har (en äldre
 * fritext går att behålla). Flera kan väljas; den först valda är huvudtypen.
 */

import { kindLabel, KNOWN_KINDS } from "@/lib/shared/document-kind";

/** Valen i ordning: inbyggda, byråns egna, sedan dokumentets övriga. */
export function kindOptions(custom: readonly string[], current: readonly string[]): string[] {
  return [...new Set([...KNOWN_KINDS, ...custom, ...current])];
}

/** Lägg till sist eller ta bort — ordningen avgör huvudtypen. */
export function toggleKind(selected: readonly string[], kind: string): string[] {
  return selected.includes(kind) ? selected.filter((k) => k !== kind) : [...selected, kind];
}

export function DocumentKindsPicker({ options, selected, onChange }: {
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const primary = selected[0];
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700 mb-1">Dokumenttyper</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 max-h-40 overflow-y-auto rounded-lg border border-gray-300 px-3 py-2">
        {options.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={selected.includes(k)} onChange={() => onChange(toggleKind(selected, k))} />
            <span>{kindLabel(k)}</span>
            {k === primary && selected.length > 1 && <span className="text-[10px] text-gray-400">huvudtyp</span>}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Välj en eller flera. Den första du väljer är huvudtypen. En ny AI-analys ändrar inte dina val.
      </p>
    </fieldset>
  );
}
