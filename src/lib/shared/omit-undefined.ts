/**
 * Tar bort nycklar vars värde är `undefined`.
 *
 * För `exactOptionalPropertyTypes` (#32): ett optional-fält `x?: T` får inte
 * sättas till explicit `undefined` — nyckeln måste utelämnas. Inline-mönstret
 * `...(v !== undefined ? { x: v } : {})` per fält fungerar men spräcker
 * complexity-gränsen när flera fält samlas. Den här helpern samlar branchningen
 * på ETT ställe så call-sites förblir enkla. Runtime oförändrat (nyckeln
 * utelämnas precis som förr).
 */
export function omitUndefined<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}
