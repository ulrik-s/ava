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
 * Flera flikar (#1346): kön läses om ur lagringen före varje reconcile, och en
 * annan fliks ändring i kön meddelas `onLocalChange`-lyssnarna.
 * Reconcile (online): `ReconcileEngine` skriver kanoniska server-rader via
 * `apply` → TYST source-skrivning (ingen re-enqueue) + persist; köade mutationer
 * spelas upp; surface-konflikter ytläggs i resultatet.
 *
 * Transport-agnostisk: tar en `SyncTransport`-port (en HTTP/tRPC-impl mot
 * server-runtimen, #410/#411, eller en fejk i tester). Principalen offline
 * kommer från en cachad session (D2/ADR 0018, `CachedSessionAuthProvider`).
 */

import { type DemoSource, prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import type { QueuedCallIdentity } from "../../queued-call";
import { pendingKeysOf, refKey, refsOf, type ApplyCanonical } from "./canonical-restore";
import type { CursorStore } from "./cursor-store";
import { InMemoryCursorStore } from "./cursor-store";
import { SOURCE_KEY_BY_ENTITY } from "./entity-source-keys";
import { repairLegacyIds } from "./legacy-id-repair";
import { LocalStore } from "./local-store";
import type { LocalStorePersistence } from "./local-store-persistence";
import {
  isProcedureCall, MutationQueue, type MutationQueuePersistence, type ProcedureTouch, type QueueEntry, type QueuedMutation,
  type QueueOwner,
} from "./mutation-queue";
import { PendingWrites, type PendingWritesView } from "./pending-writes";
import { ReconcileEngine, type ConflictRecord, type ReconcileResult } from "./reconcile-engine";
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
  /**
   * Användaren storen arbetar som (#1347): nya köposter stämplas med henne,
   * och en annan användares poster i lagringen spelas aldrig upp.
   */
  owner?: QueueOwner;
  /** Delta-sync-cursor-lagring. Default: in-memory. */
  cursor?: CursorStore;
  /**
   * Ändringar servern avvisade i en reconcile (#1266) — sparas så att ingen
   * försvinner tyst. Utan den (demo, tester) glöms de som förut.
   */
  onConflicts?: (conflicts: readonly ConflictRecord[]) => Promise<void>;
  /**
   * Körs efter varje reconcile (best-effort, fel sväljs). Server-first-klienten
   * laddar upp dokument-bytes här (#1143) — EFTER att metadatan pushats, så
   * servern har dokumentraden när innehållet kommer.
   */
  afterReconcile?: () => Promise<unknown>;
}

/** No-op-transport: ingen synk (demon = degenerat-fallet, ADR 0016 — inget synk-mål). */
export const noSyncTransport: SyncTransport = {
  pull: () => Promise.resolve({ changes: [], cursor: 0 }),
  // Inget synk-mål avvisar något — inget att återställa.
  rows: () => Promise.resolve([]),
  push: (mutation) => Promise.resolve({ status: "accepted", row: mutation.row }),
  pushProcedure: () => Promise.resolve({ status: "accepted", rows: [] }),
};

/** Ett procedur-anrop att spela in (#1265): sökväg + input som servern kör om. */
export interface ProcedureCallInput {
  path: string;
  input: Record<string, unknown>;
}

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
  const entries = queue.pending();
  const rows = entries.filter((e): e is QueuedMutation => !isProcedureCall(e));
  const repair = repairLegacyIds(source, rows);
  if (!repair.changed) return source;
  const queuedCreates = new Set(repair.queued.filter((m) => m.kind === "create").map((m) => keyOf(m.entity, m.row)));
  await queue.replaceAll(withRepairedRows(entries, repair.queued));
  for (const r of repair.recreated) {
    if (!queuedCreates.has(keyOf(r.entity, r.row))) await queue.enqueue({ entity: r.entity, kind: "create", row: r.row });
  }
  if (persistence) await persistence.save(repair.source);
  return repair.source;
}

/** Byt radposterna mot de reparerade (samma ordning); procedur-anropen står kvar på sin plats. */
function withRepairedRows(entries: readonly QueueEntry[], repaired: readonly QueuedMutation[]): QueueEntry[] {
  let next = 0;
  return entries.map((e) => (isProcedureCall(e) ? e : repaired[next++] ?? e));
}

/** Lägg till en berörd rad (en gång per rad) i ett procedur-anrops fångst. */
function recordTouch(touches: ProcedureTouch[], event: MutationEvent<Record<string, unknown>>): void {
  const id = typeof event.row.id === "string" ? event.row.id : "";
  if (!touches.some((t) => t.entity === event.entity && t.id === id)) touches.push({ entity: event.entity, id });
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
    private readonly hooks: {
      /** Lyssnare på lokala ändringar (köad + persisterad) — driver synk-efter-spara. */
      localChangeListeners: Set<() => void>;
      afterReconcile: (() => Promise<unknown>) | undefined;
      onConflicts: ((conflicts: readonly ConflictRecord[]) => Promise<void>) | undefined;
      /**
       * Aktiv under `runQueuedProcedure` (#1265): lokala radskrivningar samlas
       * här som `touches` i stället för att köas som rader. `null` = ingen.
       */
      capture: { touches: ProcedureTouch[] | null };
      /** Pågående lokala skrivningar (kö + snapshot) — se {@link pendingWrites}. */
      writes: PendingWrites;
    },
  ) {}

  /**
   * Lokala skrivningar som ännu inte nått IndexedDB (#1386). En ändring är
   * sparad när mutationen svarat; under tiden varnar sidan för att stängas.
   */
  get pendingWrites(): PendingWritesView {
    return this.hooks.writes;
  }

  /**
   * Kör en köbar procedur lokalt (#1265, ADR 0037) och köa ANROPET, inte
   * raderna den skrev. `run` körs i en lokal transaktion: kastar den rullas
   * dess skrivningar tillbaka och ingenting köas. In-process-länken kör köbara
   * procedurer exklusivt (`SharedExclusiveLock`), så ingen samtidig mutations
   * skrivningar hamnar i fångsten.
   */
  runQueuedProcedure<T>(call: ProcedureCallInput, run: (queued: QueuedCallIdentity) => Promise<T>): Promise<T> {
    return this.hooks.writes.track(() => this.recordProcedure(call, run));
  }

  private async recordProcedure<T>(call: ProcedureCallInput, run: (queued: QueuedCallIdentity) => Promise<T>): Promise<T> {
    // Anropets identitet bestäms FÖRE körningen (#1276): den lokala körningen
    // och serverns omkörning härleder skapade id:n och datum ur samma värden.
    const at = Date.now();
    const identity: QueuedCallIdentity = { mutationId: uuidv7(at), at };
    const touches: ProcedureTouch[] = [];
    this.hooks.capture.touches = touches;
    let result: T;
    try {
      result = await this.store.transaction(() => run(identity));
    } finally {
      this.hooks.capture.touches = null;
    }
    await this.queue.enqueueProcedure({ path: call.path, input: call.input, touches }, { mutationId: identity.mutationId, now: identity.at });
    await this.persistSnapshot();
    for (const listener of this.hooks.localChangeListeners) listener();
    return result;
  }

  /**
   * Köa en avvisad ändring på nytt (#1266, "Försök igen") — bara de som kan
   * lyckas (`ConflictRecord.retryable`, #1348). Posten läggs tillbaka OFÖRÄNDRAD:
   * samma köformat (servern migrerar input efter det formatet; ett nytt format
   * på gammal input hoppade över migreringen), samma kodversion och samma
   * `enqueuedAt` (anropets affärsdatum och skapade id:n härleds ur den, #1276).
   * Också samma mutationId: ett anrop som aldrig nådde fram kan ha körts utan att
   * svaret kom tillbaka, och då ger samma id det sparade utfallet i stället för
   * en andra körning. En rad byggs på serverns aktuella version (`current`), så
   * att den inte avvisas som inaktuell igen, och dess lokala läge läggs tillbaka
   * (det återställdes till serverns när den avvisades).
   */
  async requeue(entry: QueueEntry, current?: Record<string, unknown>): Promise<void> {
    if (isProcedureCall(entry)) await this.queue.requeue(entry);
    else await this.requeueRow(entry, current);
    for (const listener of this.hooks.localChangeListeners) listener();
  }

  private async requeueRow(entry: QueuedMutation, current: Record<string, unknown> | undefined): Promise<void> {
    const version = typeof current?.version === "number" ? current.version : entry.baseVersion;
    await this.queue.requeue(version === undefined ? entry : { ...entry, baseVersion: version });
    writeCanonical(this.store, entry.entity, entry.row, entry.kind === "delete");
    await this.persistSnapshot();
  }

  /**
   * Återställ raderna en avvisad ändring rörde till serverns läge just nu
   * (#1348, "Kasta"). Rader med en ny, ej synkad ändring rörs inte — den
   * ändringen gäller lokalt tills den spelats upp. Kastar när servern inte nås
   * (ändringen ligger då kvar bland de avvisade). Returnerar antalet rader.
   */
  async restore(entry: QueueEntry): Promise<number> {
    const pending = pendingKeysOf(this.queue.pending());
    const refs = refsOf(entry).filter((ref) => !pending.has(refKey(ref)));
    const changes = await this.engine.canonical(refs);
    for (const ch of changes) writeCanonical(this.store, ch.entity, ch.row, ch.deleted ?? false);
    if (changes.length > 0) {
      this.rebakeJoins();
      await this.persistSnapshot();
    }
    return changes.length;
  }

  /** Ligger en ej synkad ändring för raden kvar i kön? (rader + anropens touches) */
  hasPendingFor(entity: string, id: string): boolean {
    return pendingKeysOf(this.queue.pending()).has(refKey({ entity, id }));
  }

  /** Köposterna i ordning (rader och procedur-anrop) — för diagnostik och tester. */
  pendingEntries(): readonly QueueEntry[] {
    return this.queue.pending();
  }

  /**
   * Anropas efter varje lokal ändring, när den är köad och persisterad lokalt.
   * Klienten schemalägger en reconcile så ändringen når servern direkt — inte
   * först vid nästa sidladdning. Anropas också när en annan flik ändrat kön
   * (#1346), efter att kön lästs om. Returnerar en avregistrering.
   */
  onLocalChange(listener: () => void): () => void {
    this.hooks.localChangeListeners.add(listener);
    return () => { this.hooks.localChangeListeners.delete(listener); };
  }

  /** Hydrera (kö + source ur persistens) och komponera klossarna (server-vägen). */
  static async create(deps: CachingSyncDeps): Promise<CachingSyncDataStore> {
    const queue = await MutationQueue.hydrate(deps.queuePersistence, deps.owner);
    const hydrated = deps.persistence ? await deps.persistence.hydrate() : null;
    const source = await repairHydrated(hydrated ?? deps.seed ?? {}, queue, deps.persistence);
    const store = CachingSyncDataStore.wire(deps, queue, source);
    // En annan flik köade eller kvitterade (#1346): kön är omläst — räkna om
    // läget och synka (en flik i taget skickar, #1332), ifall den andra fliken stängs.
    queue.onExternalChange(() => { for (const listener of store.hooks.localChangeListeners) listener(); });
    return store;
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
    const writes = new PendingWrites();
    // Varje snapshot-skrivning räknas som pågående (lokala ändringar, reconcile, återställning).
    const persistSnapshot = (): Promise<void> =>
      writes.track(() => deps.persistence ? deps.persistence.save(store.currentSource) : Promise.resolve());

    const localChangeListeners = new Set<() => void>();
    const capture: { touches: ProcedureTouch[] | null } = { touches: null };
    // Varje rad köas (eller fångas som ett anrops touch) när den skrivs …
    const onLocalMutation = (event: MutationEvent<Record<string, unknown>>): Promise<void> => writes.track(async () => {
      if (capture.touches) {
        recordTouch(capture.touches, event);
        return;
      }
      // Basen är versionen ändringen BYGGDE PÅ (#1176). Repo:t har redan bumpat
      // `row.version`; servern jämför basen mot sin version och avvisade annars
      // varje surface-uppdatering (faktura) som "stale".
      const version = event.previous?.version ?? event.row.version;
      await queue.enqueue(
        {
          entity: event.entity,
          kind: event.kind,
          row: event.row,
          ...(event.previous !== undefined ? { previous: event.previous } : {}),
        },
        typeof version === "number" ? { baseVersion: version } : {},
      );
      if (deps.writeBack) await deps.writeBack(event);
    });
    // … och snapshotet skrivs EN gång per ändring (#1386): en transaktion med
    // ärende + mappar + klientkoppling gav förut ett helt snapshot per rad, och
    // mutationen svarade först när alla skrivits. Ett procedur-anrop persisterar
    // själv, efter att anropet köats (`runQueuedProcedure`).
    const onCommit = async (): Promise<void> => {
      if (capture.touches) return;
      await persistSnapshot();
      for (const listener of localChangeListeners) listener();
    };

    const store = new LocalStore(source, onLocalMutation, onCommit);

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
    return new CachingSyncDataStore(store, queue, engine, persistSnapshot, { localChangeListeners, afterReconcile: deps.afterReconcile, onConflicts: deps.onConflicts, capture, writes });
  }

  /** Reconcile mot servern (pull→apply→replay→advance) — online-vägen.
   *  Persisterar snapshotet EN gång efter hela batchen (se `apply` ovan), och
   *  bara om något faktiskt ändrades (tom poll-reconcile → ingen skrivning). */
  async reconcile(): Promise<ReconcileResult> {
    // Kön ur lagringen, inte flikens kopia (#1346): en annan flik kan ha köat
    // eller redan skickat poster sedan fliken läste sist.
    await this.queue.refresh();
    const result = await this.engine.reconcile();
    if (result.conflicts.length > 0) await this.hooks.onConflicts?.(result.conflicts);
    if (result.pulled + result.pushed + result.rebased + result.replayed + result.restored > 0) {
      this.rebakeJoins();
      await this.persistSnapshot();
    }
    // Best-effort: ett fel här får inte fälla reconcile (anroparen loggar själv).
    await this.hooks.afterReconcile?.().catch(() => undefined);
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

  /** När den äldsta ändringen i kön gjordes (epoch-ms), eller null (#1267). */
  oldestPendingAt(): number | null {
    const times = this.queue.pending().map((e) => e.enqueuedAt);
    return times.length > 0 ? Math.min(...times) : null;
  }
}
