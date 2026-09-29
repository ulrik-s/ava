/**
 * Vakt mot ett bygge som skrivits om till gammal JavaScript (#1299).
 *
 * Next 16 bygger med Turbopack, vars inbyggda webbläsardata släpar efter. Ett
 * byggmål som den inte känner till (t.ex. Chrome 146+ i Next 16.3.x) tolkas som
 * en webbläsare utan moderna funktioner, och bygget skriver om nästan all
 * modern syntax — i demo-exporten 417 → 7 `class`, 2383 → 3 `??`, 1204 → 107
 * `async`, ~11 % större klient-JS. Inget larmade. `check-bundle-size.ts` kör
 * vakten på klient-JS:en efter bygget.
 */

/** Hur mycket modern syntax klient-JS:en innehåller. */
export interface ModernSyntaxCounts {
  class: number;
  nullish: number;
  async: number;
}

/**
 * Minsta antal av varje sort i ett riktigt bygge. Ett modernt bygge har
 * hundratals-tusentals (417 / 2383 / 1204); ett omskrivet ett fåtal (7 / 3 / 107).
 */
export const MIN_MODERN_SYNTAX = 50;

const KINDS: ReadonlyArray<keyof ModernSyntaxCounts> = ["class", "nullish", "async"];

const PATTERNS: Record<keyof ModernSyntaxCounts, RegExp> = {
  class: /\bclass\b(?=\s*[\w${])/g,
  nullish: /\?\?/g,
  async: /\basync\b(?=\s*(?:function\b|\(|[\w$]+\s*=>))/g,
};

/** Räkna class-deklarationer, `??` och async-funktioner. */
export function countModernSyntax(code: string): ModernSyntaxCounts {
  const count = (re: RegExp): number => code.match(re)?.length ?? 0;
  return { class: count(PATTERNS.class), nullish: count(PATTERNS.nullish), async: count(PATTERNS.async) };
}

/** Godkänt, eller vilka sorter som (nästan) saknas. */
export type ModernSyntaxResult =
  | { ok: true; counts: ModernSyntaxCounts }
  | { ok: false; counts: ModernSyntaxCounts; missing: Array<keyof ModernSyntaxCounts> };

export function checkModernSyntax(code: string): ModernSyntaxResult {
  const counts = countModernSyntax(code);
  const missing = KINDS.filter((k) => counts[k] < MIN_MODERN_SYNTAX);
  return missing.length === 0 ? { ok: true, counts } : { ok: false, counts, missing };
}
