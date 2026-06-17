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

/** tRPC:s httpBatchLink-fetch-typ (icke-exporterad `FetchEsque`). */
type LinkFetch = NonNullable<NonNullable<Parameters<typeof httpBatchLink<AppRouter>>[0]>["fetch"]>;
export type ServerFirstFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
        ...(deps.fetch ? { fetch: deps.fetch as unknown as LinkFetch } : {}),
      }),
    ],
  });
  const cachingSync = await CachingSyncDataStore.create({
    transport: new TrpcSyncTransport(client),
    persistence: deps.persistence ?? new IndexedDbPersistence(),
    queuePersistence: deps.queuePersistence ?? new IndexedDbMutationQueuePersistence(),
  });
  if (!deps.skipInitialReconcile) await cachingSync.reconcile();
  return cachingSync;
}
