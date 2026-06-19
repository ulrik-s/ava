"use client";

/**
 * `createDemoStore` — bygger den persisterade offline-first-storen som demon
 * (och github-tier) kör mot (ADR 0016/0025, #420/#544).
 *
 * Demon hydrerar sin IndexedDB-cache via SAMMA väg som den riktiga klienten:
 * `reconcile → pull → applyPull → persist`. Transporten är en `StaticSyncSource`
 * (serverlös loopback) som serverar den bundlade `demo-seed.json`. Det enar
 * cache-populeringen på reconcile-vägen (i st.f. den gamla `seed`-optionen +
 * `loadDemoSeed`/manifest) OCH gör att varje cold-start övar reconcile-loopen
 * på riktigt (ADR 0025).
 *
 *   - Cache-hit  (snapshot finns): `create()` hydrerar source + kö ur IndexedDB.
 *     Ingen reconcile/seed-fetch behövs — datan (inkl. användarens mutationer)
 *     ligger redan i snapshotet.
 *   - Cache-miss (första besök / ny `NEXT_PUBLIC_DEMO_VERSION` → version-busting):
 *     tom store → seed laddas → `reconcile()` pull:ar in den via apply-vägen +
 *     persisterar.
 *
 * Inget riktigt synk-mål: `StaticSyncSource.push` ack:ar lokalt (loopback), så
 * mutationer köas + persisteras men når aldrig en server.
 */

import { loadBundledSeed } from "@/lib/client/demo/bundled-seed-loader";
import { demoCacheKey } from "@/lib/client/demo/demo-cache-key";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import { IndexedDbMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import { StaticSyncSource } from "@/lib/server/data-store/in-memory/static-sync-source";
import type { DemoSource } from "@/lib/shared/demo-source";

export interface CreateDemoStoreDeps {
  /** Injicerbar IndexedDB-factory (tester → fake-indexeddb). Default = global. */
  factory?: IDBFactory;
  /** Injicerbar seed-loader (tester → fake). Default = bundlad demo-seed.json. */
  loadSeed?: (repo: string) => Promise<DemoSource>;
}

/** True om source:n saknar rader (alla entitets-arrayer tomma/saknas). */
function isEmptySource(source: Record<string, unknown[] | undefined>): boolean {
  return Object.values(source).every((arr) => !arr || arr.length === 0);
}

export async function createDemoStore(
  firmaConfig: FirmaConfig,
  deps: CreateDemoStoreDeps = {},
): Promise<CachingSyncDataStore> {
  const factory = deps.factory; // undefined → IndexedDbPersistence faller till globalThis.indexedDB
  const loadSeed = deps.loadSeed ?? loadBundledSeed;
  // Source-snapshot och mutations-kö MÅSTE ligga i SKILDA IndexedDB-databaser:
  // `IdbKv` skapar bara sitt object-store i `onupgradeneeded`, och två KV mot
  // samma db-namn (men olika stores) gör att den andras store aldrig skapas →
  // `transaction(store)` kastar NotFoundError. Versionera bägge per deploy via
  // cache-nyckeln (NEXT_PUBLIC_DEMO_VERSION) men med egna namn-suffix.
  const cacheKey = demoCacheKey();
  const persistence = new IndexedDbPersistence(factory, `${cacheKey}-source`);
  const queuePersistence = new IndexedDbMutationQueuePersistence(factory, `${cacheKey}-queue`);

  // En serverlös loopback-transport. `create()` hydrerar source + kö ur
  // IndexedDB (cache-hit) eller ger en tom store (cache-miss).
  const transport = new StaticSyncSource();
  const store = await CachingSyncDataStore.create({ transport, persistence, queuePersistence });

  // Cache-miss (tom cache) → ladda seeden (en bundlad demo-seed.json) och
  // hydrera via den riktiga reconcile/pull-vägen (apply persisterar snapshotet).
  if (isEmptySource(store.store.currentSource as Record<string, unknown[] | undefined>)) {
    transport.reset(await loadSeed(firmaConfig.repo));
    await store.reconcile();
  }
  return store;
}
