/**
 * Formatversion för klientens lokala data (#1269, ADR 0037).
 *
 * IndexedDB-snapshotet överlever uppgraderingar av appen. Nya versioner kan
 * ändra radernas form; en strikt parsning av ett äldre snapshot kan då tyst
 * tappa rader. Snapshotet sparas därför med den version som skrev det, och
 * lyfts steg för steg vid start (`LOCAL_DATA_MIGRATIONS`).
 *
 *   - Ingen version sparad → skrevs före #1269, format 1.
 *   - Äldre version → migreras och sparas i dagens format.
 *   - Nyare version än koden (en flik med gammal kod öppen, eller en
 *     nedgradering) → avbryt med ett tydligt besked. Ingenting skrivs över:
 *     den nyare koden kan fortfarande läsa sina data.
 *
 * Köade ändringar (mutationskön) migreras inte här — de bär sitt eget
 * köformat och servern migrerar eller avvisar dem med besked (#1247). De tas
 * aldrig bort för att formatet är gammalt.
 *
 * Höj `LOCAL_DATA_VERSION` när en synkad entitets lokala form ändras så att
 * äldre snapshot inte klarar sig, och lägg migreringen från förra versionen i
 * `LOCAL_DATA_MIGRATIONS`.
 */

import type { DemoSource } from "@/lib/shared/demo-source";

/** Formatet den här koden skriver. */
export const LOCAL_DATA_VERSION = 1;

/** Lyfter ett snapshot från version `n` till `n + 1`. */
export type LocalDataMigration = (source: DemoSource) => DemoSource;

/** `LOCAL_DATA_MIGRATIONS[n]` lyfter version `n` → `n + 1`. Tom så länge version 1 är den enda. */
export const LOCAL_DATA_MIGRATIONS: Readonly<Record<number, LocalDataMigration>> = Object.freeze({});

/** Lokala data skrevs av en nyare AVA-version än den som körs. */
export class LocalDataTooNewError extends Error {
  constructor(readonly storedVersion: number, readonly codeVersion: number) {
    super(
      `De lokala uppgifterna sparades av en nyare version av AVA (format ${storedVersion}) än den som körs (format ${codeVersion}). `
      + "Ladda om sidan för att hämta den nya versionen — ingenting har raderats.",
    );
    this.name = "LocalDataTooNewError";
  }
}

/** Kasta `LocalDataTooNewError` om det lagrade formatet är nyare än koden (ett saknat format = 1). */
export function assertNotNewer(stored: unknown, current: number): void {
  const from = typeof stored === "number" ? stored : 1;
  if (from > current) throw new LocalDataTooNewError(from, current);
}

export interface MigratedSnapshot {
  source: DemoSource;
  /** Lyftes snapshotet (då ska det sparas i dagens format)? */
  migrated: boolean;
}

/** Lyft ett lagrat snapshot till dagens format. */
export function migrateLocalSnapshot(
  source: DemoSource,
  storedVersion: number | null,
  migrations: Readonly<Record<number, LocalDataMigration>> = LOCAL_DATA_MIGRATIONS,
  current: number = LOCAL_DATA_VERSION,
): MigratedSnapshot {
  assertNotNewer(storedVersion, current);
  const from = storedVersion ?? 1;
  let next = source;
  for (let v = from; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`Ingen migrering av lokala data från format ${v} till ${v + 1}.`);
    next = step(next);
  }
  return { source: next, migrated: from !== current };
}
