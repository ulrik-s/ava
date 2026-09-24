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
import { LEGACY_ID_NAMESPACE } from "@/lib/server/data-store/in-memory/legacy-id-repair";
import type { LocalStorePersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import {
  IndexedDbMutationQueuePersistence,
  type MutationQueuePersistence,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { AppRouter } from "@/lib/server/routers/_app";
import { asId, type DocumentId } from "@/lib/shared/schemas/ids";
import { isUuid } from "@/lib/shared/uuid";
import { uuidv5 } from "@/lib/shared/uuid-derive";
import { loadAllGeneratedDocBlobs } from "../demo/generated-doc-idb";
import { DocumentContentCache } from "./content-cache";
import { queueLocalGeneratedDocs, syncDocumentContent } from "./content-sync";
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

/** Lokalt dokument-id → serverns id (samma översättning som legacy-id-reparationen, #1124). */
export function serverDocumentId(localId: string): DocumentId {
  return asId<"DocumentId">(isUuid(localId) ? localId : uuidv5(localId, LEGACY_ID_NAMESPACE));
}

/** Räddning (#1143): köa genererade dokument som bara finns lokalt. Får aldrig stoppa uppstarten. */
async function rescueLocalGeneratedDocs(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const queued = await queueLocalGeneratedDocs(await loadAllGeneratedDocBlobs(), new DocumentContentCache(), serverDocumentId);
    if (queued > 0) console.info(`[server-first] ${queued} lokalt genererade dokument köade för upload`);
  } catch (e) {
    console.warn("[server-first] räddning av lokala dokument misslyckades:", e);
  }
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
    // Byte-synk (#518/#1143): varje reconcile laddar upp dokument-bytes servern
    // saknar — inte bara vid sidladdning.
    afterReconcile: () => syncDocumentContent(client).catch((e: unknown) => console.warn("[server-first] byte-synk misslyckades:", e)),
  });
  await rescueLocalGeneratedDocs();
  if (!deps.skipInitialReconcile) {
    // Best-effort (#879): reconcile kör pull→apply→replay, så pullad data är redan
    // hydrerad i in-memory-storen innan en ev. replay-throw. Ett sync-fel (t.ex. en
    // köad mutation med ogiltigt id) får ALDRIG ta ned bootstrappen (offline-first,
    // ADR 0016) — annars fastnar appen på "AVA loading". Kön retrias vid nästa reconcile.
    try {
      await cachingSync.reconcile();
    } catch (e) {
      console.warn("[server-first] initial reconcile misslyckades (best-effort, storen kommer ändå upp):", e);
    }
  }
  return cachingSync;
}
