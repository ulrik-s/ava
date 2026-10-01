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
 */

import { conflictClassOf, type ConflictClass } from "@/lib/shared/conflict-policy";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { classifySyncError, syncErrorMessage } from "@/lib/shared/sync/sync-error";
import type { CursorStore } from "./cursor-store";
import { isProcedureCall, type MutationQueue, type QueueEntry, type QueuedMutation, type QueuedProcedureCall } from "./mutation-queue";
import { ReplayBackoff } from "./replay-backoff";
import type { PulledChange, SyncTransport } from "./sync-transport";

/** Tyst skrivning av en kanonisk server-rad till lokal store (utan att köa om). */
export type ApplyCanonical = (
  entity: string,
  row: Record<string, unknown>,
  deleted: boolean,
) => void | Promise<void>;

export interface ConflictRecord {
  /** Radposten eller procedur-anropet som servern inte godtog. */
  mutation: QueueEntry;
  conflictClass: ConflictClass;
  reason: string;
  current?: Record<string, unknown>;
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
}

export interface ReconcileDeps {
  transport: SyncTransport;
  queue: MutationQueue;
  cursor: CursorStore;
  apply: ApplyCanonical;
  /** Omförsöken för kanske-tillfälliga fel (#1353). Injicerbar i tester. */
  backoff?: ReplayBackoff;
}

const rowId = (row: Record<string, unknown>): string =>
  typeof row.id === "string" ? row.id : "";
const keyOf = (entity: string, row: Record<string, unknown>): string => `${entity}:${rowId(row)}`;

/** Klassen en post som avvisas får i konfliktvyn. */
const conflictClassOfEntry = (m: QueueEntry): ConflictClass => (isProcedureCall(m) ? "surface" : conflictClassOf(m.entity));

export class ReconcileEngine {
  private readonly backoff: ReplayBackoff;

  constructor(private readonly deps: ReconcileDeps) {
    this.backoff = deps.backoff ?? new ReplayBackoff();
  }

  async reconcile(): Promise<ReconcileResult> {
    const since = await this.deps.cursor.get();
    const pull = await this.deps.transport.pull(since);
    const pulled = await this.applyPull(pull.changes, this.pendingKeys());
    const replay = await this.replayQueue();
    // Stannade kön flyttas inte cursorn: rader som hoppades för de poster som
    // ligger kvar hämtas igen nästa gång (idempotent).
    const cursor = replay.blocked ? since : pull.cursor;
    await this.deps.cursor.set(cursor);
    return { pulled, ...replay, cursor };
  }

  /** Rader med en ej uppspelad lokal ändring — radposter och procedur-anropens `touches`. */
  private pendingKeys(): Set<string> {
    const keys = new Set<string>();
    for (const m of this.deps.queue.pending()) {
      if (isProcedureCall(m)) for (const t of m.touches) keys.add(`${t.entity}:${t.id}`);
      else keys.add(keyOf(m.entity, m.row));
    }
    return keys;
  }

  /** Applicera kanoniska rader; hoppa rader med en ej-uppspelad lokal mutation. */
  private async applyPull(changes: readonly PulledChange[], pending: Set<string>): Promise<number> {
    let n = 0;
    for (const ch of changes) {
      if (pending.has(keyOf(ch.entity, ch.row))) continue;
      await this.deps.apply(ch.entity, ch.row, ch.deleted ?? false);
      n++;
    }
    return n;
  }

  /**
   * Spela upp kön (FIFO). accepted/rebased → applicera + ack; conflict eller
   * avvisat fel → ytlägg + ack; ett fel som ska försökas igen → stanna här.
   */
  private async replayQueue(): Promise<Tally & { blocked: BlockedEntry | null }> {
    const tally: Tally = { pushed: 0, rebased: 0, replayed: 0, conflicts: [] };
    for (const m of [...this.deps.queue.pending()]) {
      const blocked = await this.replayEntry(m, tally);
      if (blocked) return { ...tally, blocked };
      await this.deps.queue.ack(m.mutationId);
    }
    return { ...tally, blocked: null };
  }

  /** En post: null när den är klar (ska ackas), annars varför kön stannar här. */
  private async replayEntry(m: QueueEntry, tally: Tally): Promise<BlockedEntry | null> {
    const waiting = this.backoff.waiting(m.mutationId);
    if (waiting) return { mutation: m, error: waiting.error, attempts: waiting.attempts };
    try {
      if (isProcedureCall(m)) await this.replayProcedure(m, tally);
      else await this.replayRow(m, tally);
      this.backoff.clear(m.mutationId);
      return null;
    } catch (err) {
      return this.replayFailed(m, err, tally);
    }
  }

  /** Uppspelningen kastade (#1353): avvisa, försök igen senare, eller stanna. */
  private replayFailed(m: QueueEntry, err: unknown, tally: Tally): BlockedEntry | null {
    const kind = classifySyncError(err);
    if (kind === "halt") return { mutation: m, error: err, attempts: this.backoff.attempts(m.mutationId) };
    if (kind === "reject") return this.reject(m, `Servern avvisade ändringen: ${syncErrorMessage(err)}`, tally);
    const attempt = this.backoff.fail(m.mutationId, err);
    if (!attempt.exhausted) return { mutation: m, error: err, attempts: attempt.attempts };
    return this.reject(m, `Ändringen nådde inte servern efter ${attempt.attempts} försök: ${syncErrorMessage(err)}`, tally);
  }

  /** Flytta posten till konflikterna (de avvisade ändringarna) — kön fortsätter. */
  private reject(m: QueueEntry, reason: string, tally: Tally): null {
    this.backoff.clear(m.mutationId);
    tally.conflicts.push({ mutation: m, conflictClass: conflictClassOfEntry(m), reason });
    return null;
  }

  private async replayRow(m: QueuedMutation, tally: Tally): Promise<void> {
    const res = await this.deps.transport.push(m);
    if (res.status === "conflict") {
      tally.conflicts.push(omitUndefined({
        mutation: m, conflictClass: conflictClassOfEntry(m), reason: res.reason, current: res.current,
      }) as ConflictRecord);
      return;
    }
    await this.deps.apply(m.entity, res.row, false);
    if (res.status === "rebased") tally.rebased++;
    else tally.pushed++;
  }

  /**
   * Servern kör om anropet och svarar med de berörda radernas kanoniska läge.
   * Det ersätter det optimistiska läget i BÅDA utfallen — vid en avvisning
   * försvinner t.ex. en rad klienten skapat men servern vägrat (#1265).
   */
  private async replayProcedure(m: QueuedProcedureCall, tally: Tally): Promise<void> {
    const res = await this.deps.transport.pushProcedure(m);
    for (const ch of res.rows) await this.deps.apply(ch.entity, ch.row, ch.deleted ?? false);
    tally.replayed += res.rows.length;
    if (res.status === "accepted") {
      tally.pushed++;
      return;
    }
    tally.conflicts.push({ mutation: m, conflictClass: "surface", reason: res.reason });
  }
}

interface Tally {
  pushed: number;
  rebased: number;
  replayed: number;
  conflicts: ConflictRecord[];
}
