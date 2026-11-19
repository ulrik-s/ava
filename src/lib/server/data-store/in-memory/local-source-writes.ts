/**
 * Tysta skrivningar till flikens lokala källa (#415, #1360): kanoniska
 * server-rader skrivs utan att köas om, och en omsynk tar bort rader servern
 * inte längre har. Egen fil så att `caching-sync-data-store.ts` håller sig
 * under filstorleksgränsen (#1714).
 */

import { SOURCE_KEY_BY_ENTITY } from "./entity-source-keys";
import type { LocalStore } from "./local-store";

/** Nyckeln (`entitet:id`) för en rad i mängder. */
export function keyOf(entity: string, row: Record<string, unknown>): string {
  return `${entity}:${String(row.id)}`;
}

/**
 * Skriv en kanonisk server-rad TYST till lokal source (ingen re-enqueue):
 * upsert på `id`, eller ta bort vid tombstone. `entity` är singular (ADR 0017);
 * source-arrayen är plural → slå upp via {@link SOURCE_KEY_BY_ENTITY}.
 */
export function writeCanonical(store: LocalStore, entity: string, row: Record<string, unknown>, deleted: boolean): void {
  const key = SOURCE_KEY_BY_ENTITY[entity];
  if (!key) return; // okänd entitet → hoppa defensivt
  const src = store.currentSource as Record<string, Record<string, unknown>[] | undefined>;
  const arr = (src[key] ??= []);
  const idx = arr.findIndex((r) => r.id === row.id);
  if (deleted) {
    if (idx >= 0) arr.splice(idx, 1);
    return;
  }
  if (idx >= 0) arr[idx] = row;
  else arr.push(row);
}

/**
 * Omsynk efter en återställd server (#1360): ta bort lokala rader i synkade
 * entiteter vars nyckel (`entitet:id`) inte finns i `keep`. Svarar med antalet.
 */
export function pruneLocal(store: LocalStore, keep: ReadonlySet<string>): number {
  const src = store.currentSource as Record<string, Record<string, unknown>[] | undefined>;
  let pruned = 0;
  for (const [entity, key] of Object.entries(SOURCE_KEY_BY_ENTITY)) {
    const rows = src[key];
    if (!rows) continue;
    const kept = rows.filter((row) => keep.has(keyOf(entity, row)));
    pruned += rows.length - kept.length;
    src[key] = kept;
  }
  return pruned;
}
