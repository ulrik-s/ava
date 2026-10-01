/**
 * `ReconcileEngine` (ADR 0017, #414) — offline-klientens reconcile-sekvens vid
 * reconnect: **pull** (delta-cursor) → applicera kanoniska rader (hoppa rader
 * med ej-uppspelad lokal mutation) → **replay** köade mutationer server-
 * auktoritativt → **advance** cursor.
 *
 * Motorn är transport-agnostisk: den pratar med en `SyncTransport`-port och
 * skriver kanoniska rader via en injicerad `apply`-callback (wires till en TYST
 * lokal-store-skrivning i #415, så server-data inte köas om). Konflikter
 * (surface-klassen) ytläggs i resultatet — de blockerar inte resten av kön.
 *
 * En köpost vars uppspelning KASTAR (#1353) klassas ({@link classifySyncError}):
 * ett deterministiskt fel avvisas direkt (som en konflikt) och kön fortsätter;
 * ett kanske-tillfälligt fel försöks igen med backoff ({@link ReplayBackoff})
 * och avvisas efter ett begränsat antal försök; ett fel som inte beror på posten
 * (nätet, 401, 503) stoppar kön utan att räknas. Kön spelas alltid i ordning —
 * stannar den vid en post rörs inte posterna efter den, och cursorn flyttas inte
 * (raderna som hoppades för dem hämtas igen nästa gång). En post som byggde på
 * en avvisad post (en tidspost på ett ärende servern vägrade skapa) avvisas då
 * av servern i sin tur — det är avsiktligt: ordningen kastas aldrig om.
 *
 * En avvisad post lämnar ingen spökrad (#1348): raderna den ändrade lokalt
 * återställs till serverns läge sist i reconcilen ({@link RestorePlan}) —
 * serverns `current` när den följde med, annars hämtat med `sync.rows`
 * (tombstone om raden inte finns). Går läget inte att hämta (nätet) flyttas
 * inte cursorn, och raderna försöks igen nästa gång.
 */

import { conflictClassOf, type ConflictClass } from "@/lib/shared/conflict-policy";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { isProcedureOwned } from "@/lib/shared/sync/procedure-owned";
import { classifySyncError, syncErrorMessage } from "@/lib/shared/sync/sync-error";
import { fetchCanonical, pendingKeysOf, refKey, refsOf, RestorePlan, type ApplyCanonical } from "./canonical-restore";
import type { CursorStore } from "./cursor-store";
import { isProcedureCall, type MutationQueue, type QueueEntry, type QueuedMutation, type QueuedProcedureCall } from "./mutation-queue";
import { ReplayBackoff } from "./replay-backoff";
import type { PulledChange, PushResult, RowRef, SyncTransport } from "./sync-transport";

export type { ApplyCanonical } from "./canonical-restore";

export interface ConflictRecord {
  /** Radposten eller procedur-anropet som servern inte godtog. */
  mutation: QueueEntry;
  conflictClass: ConflictClass;
  reason: string;
  current?: Record<string, unknown>;
  /**
   * Kan ett nytt försök lyckas (#1348)? Nej för en deterministisk avvisning —
   * samma post avvisas igen. Ja när posten aldrig nådde fram (tillfälliga fel
   * tills gränsen nåddes) och för en versionskonflikt på en rad som radkön
   * får skriva (det nya försöket bygger på serverns `current`).
   */
  retryable: boolean;
}

/**
 * Kan en radkonflikt göras om? Bara när servern skickade sitt läge (en
 * versionskonflikt) och entiteten inte är procedurägd — en procedurägd rad
 * avvisas av radkön varje gång (#1242), med eller utan serverns rad.
 */
export function rowConflictRetryable(entry: QueueEntry, current: Record<string, unknown> | undefined): boolean {
  return current !== undefined && !isProcedureCall(entry) && !isProcedureOwned(entry.entity);
}

/** Köposten som stoppade uppspelningen (#1353) — den och allt efter den ligger kvar. */
export interface BlockedEntry {
  mutation: QueueEntry;
  /** Felet som stoppade den (det senaste, om den väntar på nästa försök). */
  error: unknown;
  /** Misslyckade försök som räknats mot gränsen (0 när felet inte beror på posten). */
  attempts: number;
}

export interface ReconcileResult {
  pulled: number;
  pushed: number;
  rebased: number;
  /** Rader ur serverns svar på omkörda procedur-anrop (#1265) — ändrar lokalt läge. */
  replayed: number;
  conflicts: ConflictRecord[];
  cursor: number;
  /** Posten kön stannade vid, eller null när hela kön spelades upp (#1353). */
  blocked: BlockedEntry | null;
  /** Rader som återställdes till serverns läge efter avvisade ändringar (#1348). */
  restored: number;
}

export interface ReconcileDeps {
  transport: SyncTransport;
  queue: MutationQueue;
  cursor: CursorStore;
  apply: ApplyCanonical;
  /** Omförsöken för kanske-tillfälliga fel (#1353). Injicerbar i tester. */
  backoff?: ReplayBackoff;
}

const refOf = (entity: string, row: Record<string, unknown>): RowRef => ({
  entity,
  id: typeof row.id === "string" ? row.id : "",
});

/** Klassen en post som avvisas får i konfliktvyn. */
const conflictClassOfEntry = (m: QueueEntry): ConflictClass => (isProcedureCall(m) ? "surface" : conflictClassOf(m.entity));

/** Varför en post avvisades, och om ett nytt försök kan lyckas. */
type Verdict = Pick<ConflictRecord, "reason" | "retryable">;

export class ReconcileEngine {
  private readonly backoff: ReplayBackoff;
  /** Rader vars läge inte gick att hämta förra gången (#1348) — försöks igen. */
  private unrestored: RowRef[] = [];

  constructor(private readonly deps: ReconcileDeps) {
    this.backoff = deps.backoff ?? new ReplayBackoff();
  }

  async reconcile(): Promise<ReconcileResult> {
    const since = await this.deps.cursor.get();
    const plan = new RestorePlan(this.unrestored);
    const pull = await this.pullAll(since, plan);
    const replay = await this.replayQueue(plan);
    const restore = await plan.run(pendingKeysOf(this.deps.queue.pending()), this.deps.transport, this.deps.apply);
    this.unrestored = restore.unrestored;
    // Stannade kön, eller gick en avvisad rad inte att återställa, flyttas inte
    // cursorn: rader som hoppades hämtas igen nästa gång (idempotent).
    const held = replay.blocked !== null || restore.unrestored.length > 0;
    const cursor = held ? since : pull.cursor;
    await this.deps.cursor.set(cursor);
    return { pulled: pull.pulled, ...replay, restored: restore.restored, cursor };
  }

  /**
   * Pulla alla sidor (#1388): servern svarar med högst en sida och `hasMore`,
   * och nästa sida hämtas från sidans cursor. Cursorn sparas först när hela
   * reconcilen är klar (som innan). Går cursorn inte framåt stannar loopen i
   * stället för att snurra.
   */
  private async pullAll(since: number, plan: RestorePlan): Promise<{ pulled: number; cursor: number }> {
    let cursor = since;
    let pulled = 0;
    for (;;) {
      const page = await this.deps.transport.pull(cursor);
      pulled += await this.applyPull(page.changes, plan);
      const advanced = page.cursor > cursor;
      cursor = page.cursor;
      if (page.hasMore !== true || !advanced) return { pulled, cursor };
    }
  }

  /**
   * Rader vars lokala läge ska ersättas med serverns i nästa reconcile (#1402):
   * en annan flik avgjorde ändringen som skrev dem här, och svaret kom bara dit.
   */
  restoreLater(refs: readonly RowRef[]): void {
    this.unrestored.push(...refs);
  }

  /** Radernas kanoniska läge just nu (#1348, "Kasta") — samma hämtning som efter en avvisning. */
  canonical(refs: readonly RowRef[]): Promise<PulledChange[]> {
    return fetchCanonical(this.deps.transport, refs);
  }

  /**
   * Applicera kanoniska rader; hoppa rader med en ej-uppspelad lokal mutation.
   * En hoppad rad läggs i planen (#1348): avgörs posten utan att servern
   * skickar radens läge, hämtas det i stället för att gå förlorat.
   */
  private async applyPull(changes: readonly PulledChange[], plan: RestorePlan): Promise<number> {
    const pending = pendingKeysOf(this.deps.queue.pending());
    let n = 0;
    for (const ch of changes) {
      const ref = refOf(ch.entity, ch.row);
      if (pending.has(refKey(ref))) {
        plan.want(ref);
        continue;
      }
      await this.deps.apply(ch.entity, ch.row, ch.deleted ?? false);
      n++;
    }
    return n;
  }

  /**
   * Spela upp kön (FIFO). accepted/rebased → applicera + ack; conflict eller
   * avvisat fel → ytlägg + ack; ett fel som ska försökas igen → stanna här.
   */
  private async replayQueue(plan: RestorePlan): Promise<Tally & { blocked: BlockedEntry | null }> {
    const tally: Tally = { pushed: 0, rebased: 0, replayed: 0, conflicts: [] };
    for (const m of [...this.deps.queue.pending()]) {
      const blocked = await this.replayEntry(m, tally, plan);
      if (blocked) return { ...tally, blocked };
      await this.deps.queue.ack(m.mutationId);
    }
    return { ...tally, blocked: null };
  }

  /** En post: null när den är klar (ska ackas), annars varför kön stannar här. */
  private async replayEntry(m: QueueEntry, tally: Tally, plan: RestorePlan): Promise<BlockedEntry | null> {
    const waiting = this.backoff.waiting(m.mutationId);
    if (waiting) return { mutation: m, error: waiting.error, attempts: waiting.attempts };
    try {
      if (isProcedureCall(m)) await this.replayProcedure(m, tally, plan);
      else await this.replayRow(m, tally, plan);
      this.backoff.clear(m.mutationId);
      return null;
    } catch (err) {
      return this.replayFailed(m, err, tally, plan);
    }
  }

  /** Uppspelningen kastade (#1353): avvisa, försök igen senare, eller stanna. */
  private replayFailed(m: QueueEntry, err: unknown, tally: Tally, plan: RestorePlan): BlockedEntry | null {
    const kind = classifySyncError(err);
    if (kind === "halt") return { mutation: m, error: err, attempts: this.backoff.attempts(m.mutationId) };
    // Deterministiskt: samma post ger samma fel igen — ett nytt försök är meningslöst.
    if (kind === "reject") return this.reject(m, { reason: `Servern avvisade ändringen: ${syncErrorMessage(err)}`, retryable: false }, tally, plan);
    const attempt = this.backoff.fail(m.mutationId, err);
    if (!attempt.exhausted) return { mutation: m, error: err, attempts: attempt.attempts };
    // Posten nådde aldrig fram — ett nytt försök senare kan lyckas.
    const reason = `Ändringen nådde inte servern efter ${attempt.attempts} försök: ${syncErrorMessage(err)}`;
    return this.reject(m, { reason, retryable: true }, tally, plan);
  }

  /**
   * Flytta posten till konflikterna (de avvisade ändringarna) — kön fortsätter.
   * Servern skickade inget läge, så raderna hämtas när kön är uppspelad (#1348).
   */
  private reject(m: QueueEntry, verdict: Verdict, tally: Tally, plan: RestorePlan): null {
    this.backoff.clear(m.mutationId);
    tally.conflicts.push({ mutation: m, conflictClass: conflictClassOfEntry(m), ...verdict });
    for (const ref of refsOf(m)) plan.want(ref);
    return null;
  }

  private async replayRow(m: QueuedMutation, tally: Tally, plan: RestorePlan): Promise<void> {
    const res = await this.deps.transport.push(m);
    if (res.status === "conflict") {
      this.rowConflict(m, res, tally, plan);
      return;
    }
    // En godtagen radering är en tombstone (#1397) — också när servern svarar
    // med en rad: raden tas bort lokalt, den skrivs aldrig som levande.
    await this.deps.apply(m.entity, res.row, m.kind === "delete" || isTombstone(res));
    plan.settled(refOf(m.entity, m.row));
    if (res.status === "rebased") tally.rebased++;
    else tally.pushed++;
  }

  /** Servern avvisade raden: dess läge (`current`) återställs, annars hämtas det (#1348). */
  private rowConflict(m: QueuedMutation, res: { reason: string; current?: Record<string, unknown> }, tally: Tally, plan: RestorePlan): void {
    const retryable = rowConflictRetryable(m, res.current);
    tally.conflicts.push(omitUndefined({
      mutation: m, conflictClass: conflictClassOfEntry(m), reason: res.reason, current: res.current, retryable,
    }) as ConflictRecord);
    if (res.current) plan.know({ entity: m.entity, row: res.current });
    else plan.want(refOf(m.entity, m.row));
  }

  /**
   * Servern kör om anropet och svarar med de berörda radernas kanoniska läge.
   * Det ersätter det optimistiska läget i BÅDA utfallen — vid en avvisning
   * försvinner t.ex. en rad klienten skapat men servern vägrat (#1265).
   */
  private async replayProcedure(m: QueuedProcedureCall, tally: Tally, plan: RestorePlan): Promise<void> {
    const res = await this.deps.transport.pushProcedure(m);
    for (const ch of res.rows) await this.deps.apply(ch.entity, ch.row, ch.deleted ?? false);
    // Servern svarade för alla berörda rader (de den inte kan läsa synkas inte).
    for (const ref of m.touches) plan.settled(ref);
    tally.replayed += res.rows.length;
    if (res.status === "accepted") {
      tally.pushed++;
      return;
    }
    // Servern har sparat avvisningen för anropet: samma anrop avvisas igen.
    tally.conflicts.push({ mutation: m, conflictClass: "surface", reason: res.reason, retryable: false });
  }
}

/** Svarade servern med en tombstone (`deleted`, #1397)? */
const isTombstone = (res: PushResult): boolean => res.status === "accepted" && res.deleted === true;

interface Tally {
  pushed: number;
  rebased: number;
  replayed: number;
  conflicts: ConflictRecord[];
}
