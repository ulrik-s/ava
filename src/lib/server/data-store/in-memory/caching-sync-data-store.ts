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

import { type DemoSource, prebakeJoins } from "@/lib/shared/demo-source";
import type { CursorStore } from "./cursor-store";
import { InMemoryCursorStore } from "./cursor-store";
import { SOURCE_KEY_BY_ENTITY } from "./entity-source-keys";
import { repairLegacyIds } from "./legacy-id-repair";
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

/**
 * Rader med icke-uuid-id (skapade innan klienten genererade uuid) nådde aldrig
 * servern. Ge dem deterministiska uuid:n, skriv om alla referenser, köa dem som
 * create och persistera — innan första reconcile. No-op när allt redan är uuid.
 */
async function repairHydrated(
  source: DemoSource,
  queue: MutationQueue,
  persistence: LocalStorePersistence | undefined,
): Promise<DemoSource> {
  const repair = repairLegacyIds(source, queue.pending());
  if (!repair.changed) return source;
  const queuedCreates = new Set(repair.queued.filter((m) => m.kind === "create").map((m) => keyOf(m.entity, m.row)));
  await queue.replaceAll(repair.queued);
  for (const r of repair.recreated) {
    if (!queuedCreates.has(keyOf(r.entity, r.row))) await queue.enqueue({ entity: r.entity, kind: "create", row: r.row });
  }
  if (persistence) await persistence.save(repair.source);
  return repair.source;
}

function keyOf(entity: string, row: Record<string, unknown>): string {
  return `${entity}:${String(row.id)}`;
}

export class CachingSyncDataStore {
  private constructor(
    /** Den `IDataStore` appen läser/skriver mot (lokal-först) — `ctx.dataStore`. */
    readonly store: LocalStore,
    private readonly queue: MutationQueue,
    private readonly engine: ReconcileEngine,
    /** Persistera hela source-snapshotet (en gång per reconcile-batch). */
    private readonly persistSnapshot: () => Promise<void>,
    /** Lyssnare på lokala ändringar (köad + persisterad) — driver synk-efter-spara. */
    private readonly localChangeListeners: Set<() => void>,
  ) {}

  /**
   * Anropas efter varje lokal ändring, när den är köad och persisterad lokalt.
   * Klienten schemalägger en reconcile så ändringen når servern direkt — inte
   * först vid nästa sidladdning. Returnerar en avregistrering.
   */
  onLocalChange(listener: () => void): () => void {
    this.localChangeListeners.add(listener);
    return () => { this.localChangeListeners.delete(listener); };
  }

  /** Hydrera (kö + source ur persistens) och komponera klossarna (server-vägen). */
  static async create(deps: CachingSyncDeps): Promise<CachingSyncDataStore> {
    const queue = await MutationQueue.hydrate(deps.queuePersistence);
    const hydrated = deps.persistence ? await deps.persistence.hydrate() : null;
    const source = await repairHydrated(hydrated ?? deps.seed ?? {}, queue, deps.persistence);
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

    const localChangeListeners = new Set<() => void>();
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
      for (const listener of localChangeListeners) listener();
    };

    const store = new LocalStore(source, onLocalMutation);

    // apply skriver bara till lokal store — INGEN persist per rad. En reconcile
    // som hydrerar hela seeden (#544: ~500 rader) skulle annars trigga ~500
    // snapshot-skrivningar av en växande source (O(n²) bytes → hängde demon på
    // mobil-IndexedDB, "AVA laddar…"). `reconcile()` persisterar EN gång efter
    // hela batchen i st.f. Mid-reconcile-krasch → cursorn ej advancerad → rader
    // re-pullas nästa gång (idempotent), så inget tappas.
    const apply: ApplyCanonical = (entity, row, deleted) => {
      writeCanonical(store, entity, row, deleted);
    };

    const engine = new ReconcileEngine({ transport: deps.transport, queue, cursor, apply });
    return new CachingSyncDataStore(store, queue, engine, persistSnapshot, localChangeListeners);
  }

  /** Reconcile mot servern (pull→apply→replay→advance) — online-vägen.
   *  Persisterar snapshotet EN gång efter hela batchen (se `apply` ovan), och
   *  bara om något faktiskt ändrades (tom poll-reconcile → ingen skrivning). */
  async reconcile(): Promise<ReconcileResult> {
    const result = await this.engine.reconcile();
    if (result.pulled > 0 || result.pushed > 0 || result.rebased > 0) {
      this.rebakeJoins();
      await this.persistSnapshot();
    }
    return result;
  }

  /**
   * Re-baka relations-joins (#633) på source efter en reconcile. `apply`/
   * `writeCanonical` skriver RÅA kanoniska server-rader (matterContact utan
   * `.contact`, timeEntry utan `.matter`, …) — men UI:t/routrarna förlitar sig
   * på de förbakade join-fälten (samma som demo-vägens `prebakeJoins` vid
   * laddning), och query-motorns nested-include täcker inte alla dessa relationer
   * (t.ex. `matters.contacts.contact`). Lokala mutationer bakas redan via
   * `LocalStore.enrichRowForEntity`; bara pullade rader är råa. `prebakeJoins`
   * är en ren `DemoSource → DemoSource` och idempotent → skriv tillbaka varje
   * bakad array in-place så `getSource`-closuren (LocalStore) ser dem.
   */
  private rebakeJoins(): void {
    const src = this.store.currentSource as Record<string, unknown>;
    const baked = prebakeJoins(this.store.currentSource) as Record<string, unknown>;
    for (const key of Object.keys(baked)) src[key] = baked[key];
  }

  /** Antal ej-synkade (köade) mutationer. */
  pendingCount(): number {
    return this.queue.size();
  }
}
