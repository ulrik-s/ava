/**
 * `loadFromStorage` — zod-validerad localStorage-läsning (#187).
 *
 * Ersätter mönstret `JSON.parse(raw) as Partial<X>` + manuella typeof-koll
 * som fanns i firma-config, oauth-config, authSettings, llm-config m.fl.
 * Stilregeln: zod vid varje parsegräns — även egen lagring (en annan flik/
 * äldre version/handredigering kan ha skrivit vad som helst).
 *
 * Tolerant per design: trasig JSON eller schema-miss → fallback (lagrings-
 * preferenser ska aldrig krascha appen), men det som RETURNERAS är alltid
 * schema-validerat — ovaliderad data sprids aldrig in i domänobjekt.
 */

import type { z } from "zod";

export function loadFromStorage<S extends z.ZodType>(
  key: string,
  schema: S,
  fallback: z.infer<S>,
): z.infer<S> {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as z.infer<S>) : fallback;
  } catch {
    return fallback;
  }
}
