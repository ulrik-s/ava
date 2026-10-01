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
  type QueueOwner,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { AppRouter } from "@/lib/server/routers/_app";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { asId, type DocumentId } from "@/lib/shared/schemas/ids";
import { isUuid } from "@/lib/shared/uuid";
import { uuidv5 } from "@/lib/shared/uuid-derive";
import { loadAllGeneratedDocBlobs } from "../demo/generated-doc-idb";
import { DocumentContentCache } from "./content-cache";
import { queueLocalGeneratedDocs, syncDocumentContent } from "./content-sync";
import { serverTrpcEndpoint } from "./http-backend-runtime";
import { queueLocation, rejectedLocation, type LocalDataPlace } from "./local-data/local-data-locations";
import { activeLocalNamespace, dbNameIn, LOCAL_DB } from "./local-data/local-namespace";
import {
  IndexedDbRejectedChangesPersistence, InMemoryRejectedChangesPersistence, rejectedChanges,
  type RejectedChanges, type RejectedChangesPersistence,
} from "./rejected-changes";

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
  /** Var avvisade ändringar sparas (#1266). Default: flikens, i IndexedDB. */
  rejected?: { changes: RejectedChanges; persistence: RejectedChangesPersistence };
  /**
   * Vems lokala databaser (#1347). Default: den bundna namnrymdens.
   * `"binding"` = bindningsfasen (ny eller annan identitet): allt i minnet —
   * ingenting sparas lokalt, ingen räddning och ingen byte-synk, förrän det
   * är avgjort vem som loggar in.
   */
  local?: LocalDataPlace | "binding";
}

/** Storens lokala lagring för en plats (#1347). */
interface LocalParts {
  persistence?: LocalStorePersistence;
  queuePersistence?: MutationQueuePersistence;
  rejected: RejectedChangesPersistence;
  owner?: QueueOwner;
  /** Sparas något lokalt (räddning + byte-synk), eller är allt i minnet? */
  persistent: boolean;
}

/** IndexedDB i webbläsaren; i minnet där den saknas (tester, äldre miljöer). */
function rejectedPersistence(place: LocalDataPlace): RejectedChangesPersistence {
  return typeof place.factory === "undefined"
    ? new InMemoryRejectedChangesPersistence()
    : new IndexedDbRejectedChangesPersistence(place.factory, rejectedLocation(place));
}

/** Platsens databaser; köposterna stämplas med användaren (#1347). */
function placeParts(place: LocalDataPlace): LocalParts {
  return {
    persistence: new IndexedDbPersistence(place.factory, dbNameIn(place.ns, LOCAL_DB.localStore)),
    queuePersistence: new IndexedDbMutationQueuePersistence(place.factory, queueLocation(place)),
    rejected: rejectedPersistence(place),
    ...(place.ns.kind === "user" ? { owner: place.ns.scope } : {}),
    persistent: true,
  };
}

function localParts(local: ServerFirstStoreDeps["local"]): LocalParts {
  if (local === "binding") return { rejected: new InMemoryRejectedChangesPersistence(), persistent: false };
  return placeParts(local ?? { factory: globalThis.indexedDB, ns: activeLocalNamespace(), adoptsLegacy: false });
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

/** Storens lagring: testets överstyrning, annars platsens (#1347). */
function storageOf(deps: ServerFirstStoreDeps, local: LocalParts) {
  return omitUndefined({
    persistence: deps.persistence ?? local.persistence,
    queuePersistence: deps.queuePersistence ?? local.queuePersistence,
    owner: local.owner,
  });
}

/**
 * Bygg + hydrera self-hosted-klientens server-first-store och gör en initial
 * reconcile (pull) mot servern. Returnerar `CachingSyncDataStore` — `.store` är
 * `ctx.dataStore`, `.reconcile()` driver löpande synk.
 */
export async function createServerFirstStore(deps: ServerFirstStoreDeps = {}): Promise<CachingSyncDataStore> {
  const local = localParts(deps.local);
  const rejected = deps.rejected ?? { changes: rejectedChanges, persistence: local.rejected };
  await rejected.changes.attach(rejected.persistence);
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
    ...storageOf(deps, local),
    // Byte-synk (#518/#1143): varje reconcile laddar upp dokument-bytes servern
    // saknar — inte bara vid sidladdning. Bindningsfasen har inga lokala bytes.
    afterReconcile: () => (local.persistent ? syncDocumentContent(client) : Promise.resolve())
      .catch((e: unknown) => console.warn("[server-first] byte-synk misslyckades:", e)),
    // Avvisade ändringar sparas (#1266) — ingen försvinner tyst.
    onConflicts: (conflicts) => rejected.changes.record(conflicts),
  });
  if (local.persistent) await rescueLocalGeneratedDocs();
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
