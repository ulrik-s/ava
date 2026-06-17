/**
 * `CachingSyncDataStore` (#415, ADR 0016/0017) — den offline-first-väg appen
 * faktiskt kör mot i server-first-arkitekturen. Komponerar de tre klossarna:
 *
 *   C1  LocalStore (#412)        — lokal store-kärna; läser/skriver direkt (snabbt, offline).
 *   C2  MutationQueue (#413)     — varje lokal mutation köas optimistiskt (UUIDv7, idempotent).
 *   C3  ReconcileEngine (#414)   — vid reconnect: pull→apply→replay→advance mot servern.
 *
 * Komposition framför arv: `LocalStore`s `onMutate` injiceras i konstruktorn och
 * måste referera kö/persistens, vilket `super(...)`-argument inte kan (this-före-
 * super). Wrappern exponerar därför `.store` (den `IDataStore` appen använder som
 * `ctx.dataStore`) + sync-kontrollerna (`reconcile`, `pendingCount`).
 *
 * Skrivflöde (offline): mutation → LocalStore uppdaterar source → `onMutate`
 * → enqueue + persist. Inga nätanrop.
 * Reconcile (online): `ReconcileEngine` skriver kanoniska server-rader via
 * `apply` → TYST source-skrivning (ingen re-enqueue) + persist; köade mutationer
 * spelas upp; surface-konflikter ytläggs i resultatet.
 *
 * Transport-agnostisk: tar en `SyncTransport`-port (en HTTP/tRPC-impl mot
 * server-runtimen, #410/#411, eller en fejk i tester). Principalen offline
 * kommer från en cachad session (D2/ADR 0018, `CachedSessionAuthProvider`).
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import type { CursorStore } from "./cursor-store";
import { InMemoryCursorStore } from "./cursor-store";
import { SOURCE_KEY_BY_ENTITY } from "./entity-source-keys";
import { LocalStore } from "./local-store";
import type { LocalStorePersistence } from "./local-store-persistence";
import { MutationQueue, type MutationQueuePersistence } from "./mutation-queue";
import { ReconcileEngine, type ApplyCanonical, type ReconcileResult } from "./reconcile-engine";
import type { SyncTransport } from "./sync-transport";
import type { MutationEvent } from "./writable-delegate";

export interface CachingSyncDeps {
  /** Port mot den server-auktoritativa sidan (pull/push). Fejk i tester. */
  transport: SyncTransport;
  /** Seed-data om persistensen är tom (eller saknas). */
  seed?: DemoSource;
  /** Hydrera/spara hela source:n (snapshot — IndexedDB i browsern). */
  persistence?: LocalStorePersistence;
  /**
   * Per-mutation write-back (alternativ till `persistence`): anropas med varje
   * `MutationEvent` så caller:n kan persistera finkornigt. Demo-vägen (#419) ger
   * sin slab/FSA-pipeline här i st.f. snapshot-persistens.
   */
  writeBack?: (event: MutationEvent<Record<string, unknown>>) => void | Promise<void>;
  /** Persistens för mutations-kön (IndexedDB i browsern). */
  queuePersistence?: MutationQueuePersistence;
  /** Delta-sync-cursor-lagring. Default: in-memory. */
  cursor?: CursorStore;
}

/** No-op-transport: ingen synk (demon = degenerat-fallet, ADR 0016 — inget synk-mål). */
export const noSyncTransport: SyncTransport = {
  pull: () => Promise.resolve({ changes: [], cursor: 0 }),
  push: (mutation) => Promise.resolve({ status: "accepted", row: mutation.row }),
};

/**
 * Skriv en kanonisk server-rad TYST till lokal source (ingen re-enqueue):
 * upsert på `id`, eller ta bort vid tombstone. `entity` är singular (ADR 0017);
 * source-arrayen är plural → slå upp via {@link SOURCE_KEY_BY_ENTITY}.
 */
function writeCanonical(store: LocalStore, entity: string, row: Record<string, unknown>, deleted: boolean): void {
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

export class CachingSyncDataStore {
  private constructor(
    /** Den `IDataStore` appen läser/skriver mot (lokal-först) — `ctx.dataStore`. */
    readonly store: LocalStore,
    private readonly queue: MutationQueue,
    private readonly engine: ReconcileEngine,
  ) {}

  /** Hydrera (kö + source ur persistens) och komponera klossarna (server-vägen). */
  static async create(deps: CachingSyncDeps): Promise<CachingSyncDataStore> {
    const queue = await MutationQueue.hydrate(deps.queuePersistence);
    const hydrated = deps.persistence ? await deps.persistence.hydrate() : null;
    const source: DemoSource = hydrated ?? deps.seed ?? {};
    return CachingSyncDataStore.wire(deps, queue, source);
  }

  /**
   * Synkron variant utan async-hydrering: tom kö, seed direkt. Demo-vägen (#419)
   * — inget synk-mål, ingen kö-persistens; mutationer persisteras via `writeBack`.
   */
  static createEphemeral(deps: CachingSyncDeps): CachingSyncDataStore {
    return CachingSyncDataStore.wire(deps, new MutationQueue(), deps.seed ?? {});
  }

  /** Komponera LocalStore (onMutate → enqueue + persist) + ReconcileEngine. */
  private static wire(deps: CachingSyncDeps, queue: MutationQueue, source: DemoSource): CachingSyncDataStore {
    const cursor = deps.cursor ?? new InMemoryCursorStore();
    const persistSnapshot = (): Promise<void> =>
      deps.persistence ? deps.persistence.save(store.currentSource) : Promise.resolve();

    const onLocalMutation = async (event: MutationEvent<Record<string, unknown>>): Promise<void> => {
      const version = event.row.version;
      await queue.enqueue(
        {
          entity: event.entity,
          kind: event.kind,
          row: event.row,
          ...(event.previous !== undefined ? { previous: event.previous } : {}),
        },
        typeof version === "number" ? { baseVersion: version } : {},
      );
      await persistSnapshot();
      if (deps.writeBack) await deps.writeBack(event);
    };

    const store = new LocalStore(source, onLocalMutation);

    const apply: ApplyCanonical = async (entity, row, deleted) => {
      writeCanonical(store, entity, row, deleted);
      await persistSnapshot();
    };

    const engine = new ReconcileEngine({ transport: deps.transport, queue, cursor, apply });
    return new CachingSyncDataStore(store, queue, engine);
  }

  /** Reconcile mot servern (pull→apply→replay→advance) — online-vägen. */
  reconcile(): Promise<ReconcileResult> {
    return this.engine.reconcile();
  }

  /** Antal ej-synkade (köade) mutationer. */
  pendingCount(): number {
    return this.queue.size();
  }
}
