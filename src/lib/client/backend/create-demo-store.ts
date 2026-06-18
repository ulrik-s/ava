"use client";

/**
 * `createDemoStore` — bygger den persisterade offline-first-storen som demon
 * (och github-tier) kör mot (ADR 0016, #420).
 *
 * `CachingSyncDataStore.create()` hydrerar IndexedDB-cachen först; finns inget
 * cachat (första besök, eller ny `NEXT_PUBLIC_DEMO_VERSION` → ny cache-nyckel →
 * version-busting) fetchas seed:en från GH Pages via `loadDemoSeed`. Vi
 * persisterar då seed:en direkt så efterföljande mutationer kan läggas till
 * ovanpå och överleva reload — "populera IndexedDB-cachen med demo-data".
 *
 * Inget synk-mål (`noSyncTransport`): demon synkar aldrig. Mutationer köas
 * lokalt + persisteras (snapshot + kö) men pushas aldrig.
 */

import { demoCacheKey } from "@/lib/client/demo/demo-cache-key";
import { loadDemoSeed } from "@/lib/client/demo/demo-seed-loader";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { CachingSyncDataStore, noSyncTransport } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import { IndexedDbMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { DemoSource } from "@/lib/shared/demo-source";

export interface CreateDemoStoreDeps {
  /** Injicerbar IndexedDB-factory (tester → fake-indexeddb). Default = global. */
  factory?: IDBFactory;
  /** Injicerbar seed-loader (tester → fake). Default = GH-Pages-fetch. */
  loadSeed?: (repo: string) => Promise<DemoSource>;
}

export async function createDemoStore(
  firmaConfig: FirmaConfig,
  deps: CreateDemoStoreDeps = {},
): Promise<CachingSyncDataStore> {
  const factory = deps.factory; // undefined → IndexedDbPersistence faller till globalThis.indexedDB
  const loadSeed = deps.loadSeed ?? loadDemoSeed;
  // Source-snapshot och mutations-kö MÅSTE ligga i SKILDA IndexedDB-databaser:
  // `IdbKv` skapar bara sitt object-store i `onupgradeneeded`, och två KV mot
  // samma db-namn (men olika stores) gör att den andras store aldrig skapas →
  // `transaction(store)` kastar NotFoundError. Versionera bägge per deploy via
  // cache-nyckeln (NEXT_PUBLIC_DEMO_VERSION) men med egna namn-suffix.
  const cacheKey = demoCacheKey();
  const persistence = new IndexedDbPersistence(factory, `${cacheKey}-source`);
  const queuePersistence = new IndexedDbMutationQueuePersistence(factory, `${cacheKey}-queue`);

  // Cache-hit? Hydrera utan nät-roundtrip (bevarar användarens mutationer).
  const cached = await persistence.hydrate();
  if (cached) {
    return CachingSyncDataStore.create({ transport: noSyncTransport, persistence, queuePersistence, seed: cached });
  }

  // Cache-miss: fetcha färsk seed från GH Pages och persistera den direkt.
  const seed = await loadSeed(firmaConfig.repo);
  await persistence.save(seed);
  return CachingSyncDataStore.create({ transport: noSyncTransport, persistence, queuePersistence, seed });
}
