/**
 * `createServerFirstStore` (#2b, ADR 0016) — self-hosted-klientens offline-first-
 * store i server-first-läge: en `CachingSyncDataStore` synkad mot den deployade
 * server-first-runtimen (#479) via `TrpcSyncTransport` över HTTP, persisterad i
 * IndexedDB. Ersätter iso-git-vägen (clone/push/pull) för self-hosted.
 *
 * Routrarna körs fortsatt i klienten (in-process) mot `.store`; synk sker via
 * `reconcile()` (pull→apply→replay→advance) i st.f. git. Auth rider på
 * oauth2-proxy:s samma-origin-cookie (ADR 0009) — `fetch` default skickar den.
 *
 * Additiv: detta är den server-first-väg self-hosted byter TILL. Git-default
 * + round-trip-E2E rörs inte förrän cutovern (#420–#422) — då flippas valet.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { toLinkFetch, type InjectableFetch } from "@/lib/client/link-fetch";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import type { LocalStorePersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import {
  IndexedDbMutationQueuePersistence,
  type MutationQueuePersistence,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { AppRouter } from "@/lib/server/routers/_app";
import { serverTrpcEndpoint } from "./http-backend-runtime";

export type ServerFirstFetch = InjectableFetch;

export interface ServerFirstStoreDeps {
  /** Server-bas-URL. Tom (default) = samma origin (bakom nginx/oauth2-proxy). */
  baseUrl?: string;
  /** Source-persistens. Default IndexedDB (browser). Override i tester. */
  persistence?: LocalStorePersistence;
  /** Mutations-kö-persistens. Default IndexedDB. Override i tester. */
  queuePersistence?: MutationQueuePersistence;
  /** `fetch`-override (test/icke-standard-runtime). Default global fetch (samma-origin-cookie). */
  fetch?: ServerFirstFetch;
  /** Hoppa initial reconcile (pull) — för tester som kontrollerar timing. */
  skipInitialReconcile?: boolean;
}

/**
 * Bygg + hydrera self-hosted-klientens server-first-store och gör en initial
 * reconcile (pull) mot servern. Returnerar `CachingSyncDataStore` — `.store` är
 * `ctx.dataStore`, `.reconcile()` driver löpande synk.
 */
export async function createServerFirstStore(deps: ServerFirstStoreDeps = {}): Promise<CachingSyncDataStore> {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: serverTrpcEndpoint(deps.baseUrl),
        transformer: superjson,
        ...(deps.fetch ? { fetch: toLinkFetch(deps.fetch) } : {}),
      }),
    ],
  });
  const cachingSync = await CachingSyncDataStore.create({
    transport: new TrpcSyncTransport(client),
    persistence: deps.persistence ?? new IndexedDbPersistence(),
    queuePersistence: deps.queuePersistence ?? new IndexedDbMutationQueuePersistence(),
  });
  if (!deps.skipInitialReconcile) {
    await cachingSync.reconcile();
    // Byte-synk (#518, ADR 0023): ladda upp dokument-blobbar servern saknar.
    // Best-effort — får aldrig ta ned bootstrappen (tom pending → no-op).
    const { syncDocumentContent } = await import("./content-sync");
    void syncDocumentContent(client).catch(() => {});
  }
  return cachingSync;
}
