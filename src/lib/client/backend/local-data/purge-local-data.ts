/**
 * Rensa en användares lokala data (#1347) — vid utloggning och när en annan
 * användare loggar in i samma webbläsare.
 *
 * Beslutet (docs/auth.md, "Lokal data och utloggning"): webbläsarprofilen är
 * gemensam för alla som använder datorn, så det som ligger kvar efter en
 * utloggning kan läsas av nästa person (utvecklarverktygen räcker). Därför tas
 * allt som bara är en kopia av serverns data bort:
 *   - cachen av byråns data och dokumenttexten,
 *   - dokumentbytes som inte väntar på uppladdning.
 * Det enda som ligger kvar är användarens eget osynkade arbete — köade och
 * avvisade ändringar, dokument som väntar på uppladdning och fakturadokument
 * som väntar på sitt nummer — i hennes egna databaser, tills hon loggar in
 * igen. Finns inget sådant tas allt bort.
 *
 * En radering som blockeras (en annan flik håller databasen öppen) sparas i
 * `localStorage` och görs om vid nästa start, innan något öppnas.
 */

import { z } from "zod";
import { IdbEntryStore } from "@/lib/server/data-store/in-memory/idb-entry-store";
import { deleteDatabase, openExistingDatabase } from "@/lib/server/data-store/in-memory/idb-open";
import { DocumentContentCache } from "../content-cache";
import { IndexedDbListStore } from "../idb-list-store";
import { queueLocation, rejectedLocation, type LocalDataPlace } from "./local-data-locations";
import { dbNameIn, LOCAL_DB, SHARED_NAMESPACE, type LocalDbBase } from "./local-namespace";

/** localStorage-nyckeln för raderingar som ännu inte gått igenom. */
export const PENDING_PURGE_KEY = "ava.localData.pendingPurge";

/** Det rensningen behöver ur webbläsaren (injicerbart i tester). */
export interface PurgeEnv {
  factory: IDBFactory;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Hur länge en blockerad radering väntar. */
  timeoutMs?: number;
}

const ALL_BASES: readonly LocalDbBase[] = Object.values(LOCAL_DB);
const pendingSchema = z.array(z.string()).catch([]);

function pendingPurges(env: PurgeEnv): string[] {
  try {
    return pendingSchema.parse(JSON.parse(env.storage.getItem(PENDING_PURGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function savePendingPurges(env: PurgeEnv, names: readonly string[]): void {
  if (names.length === 0) env.storage.removeItem(PENDING_PURGE_KEY);
  else env.storage.setItem(PENDING_PURGE_KEY, JSON.stringify(names));
}

/** Radera databaserna; de som inte gick att radera nu görs om vid nästa start. */
async function deleteAll(env: PurgeEnv, names: readonly string[]): Promise<void> {
  const remaining = new Set([...pendingPurges(env), ...names]);
  savePendingPurges(env, [...remaining]);
  for (const name of names) {
    if (await deleteDatabase(env.factory, name, env.timeoutMs)) remaining.delete(name);
  }
  savePendingPurges(env, [...remaining]);
}

/** Gör om raderingar som blockerades förra gången (vid start, innan något öppnas). */
export async function resumePendingPurge(env: PurgeEnv): Promise<void> {
  const names = pendingPurges(env);
  if (names.length > 0) await deleteAll(env, names);
}

async function entryCount(place: LocalDataPlace, location: typeof queueLocation): Promise<number> {
  return (await new IdbEntryStore({ factory: place.factory, location: location(place), schema: z.unknown() }).records()).length;
}

/** Databaserna med osynkat arbete som inte är tomma. */
async function unsyncedWork(place: LocalDataPlace, pendingUploads: number): Promise<Set<LocalDbBase>> {
  const deferred = await new IndexedDbListStore<unknown>(dbNameIn(place.ns, LOCAL_DB.deferredFakturaDocs), place.factory).load();
  const counts: ReadonlyArray<[LocalDbBase, number]> = [
    [LOCAL_DB.mutationQueue, await entryCount(place, queueLocation)],
    [LOCAL_DB.rejectedChanges, await entryCount(place, rejectedLocation)],
    [LOCAL_DB.docContent, pendingUploads],
    // Räddningskopiorna av genererade dokument hör till uppladdningarna.
    [LOCAL_DB.generatedDocs, pendingUploads],
    [LOCAL_DB.deferredFakturaDocs, deferred.length],
  ];
  return new Set(counts.filter(([, n]) => n > 0).map(([base]) => base));
}

/** Utfallet: vilka databaser som behölls (användarens osynkade arbete). */
export interface PurgeResult {
  kept: LocalDbBase[];
}

/**
 * Rensa användarens lokala data (`place.ns` = hennes namnrymd). Äger hon de
 * gemensamma databaserna från före #1347 (`place.adoptsLegacy`) flyttas deras
 * köade ändringar först in, så att ingen går förlorad.
 */
export async function purgeLocalData(env: PurgeEnv, place: LocalDataPlace): Promise<PurgeResult> {
  const pendingUploads = await new DocumentContentCache(place.factory, dbNameIn(place.ns, LOCAL_DB.docContent)).purgeReadCache();
  const kept = await unsyncedWork(place, pendingUploads);
  await deleteAll(env, ALL_BASES.filter((b) => !kept.has(b)).map((b) => dbNameIn(place.ns, b)));
  return { kept: ALL_BASES.filter((b) => kept.has(b)) };
}

/** Töm den gemensamma läs-cachen (om den finns) och räkna de väntande uppladdningarna. */
async function legacyPendingUploads(factory: IDBFactory): Promise<number> {
  const name = dbNameIn(SHARED_NAMESPACE, LOCAL_DB.docContent);
  const existing = await openExistingDatabase(factory, name);
  if (!existing) return 0;
  existing.close();
  return new DocumentContentCache(factory, name).purgeReadCache();
}

/**
 * De gemensamma databaserna från före #1347, när användaren som arbetar nu
 * inte äger dem: kopiorna av serverns data tas bort; köade ändringar och
 * väntande uppladdningar ligger kvar orörda åt sin ägare.
 */
export async function purgeLegacyCaches(env: PurgeEnv): Promise<void> {
  const pendingUploads = await legacyPendingUploads(env.factory);
  const caches: LocalDbBase[] = [LOCAL_DB.localStore, LOCAL_DB.docText, ...(pendingUploads > 0 ? [] : [LOCAL_DB.docContent])];
  await deleteAll(env, caches.map((b) => dbNameIn(SHARED_NAMESPACE, b)));
}
