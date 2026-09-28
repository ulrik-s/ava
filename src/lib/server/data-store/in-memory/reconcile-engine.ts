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
 */

import { conflictClassOf, type ConflictClass } from "@/lib/shared/conflict-policy";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { CursorStore } from "./cursor-store";
import { isProcedureCall, type MutationQueue, type QueueEntry, type QueuedMutation, type QueuedProcedureCall } from "./mutation-queue";
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

export interface ReconcileResult {
  pulled: number;
  pushed: number;
  rebased: number;
  /** Rader ur serverns svar på omkörda procedur-anrop (#1265) — ändrar lokalt läge. */
  replayed: number;
  conflicts: ConflictRecord[];
  cursor: number;
}

export interface ReconcileDeps {
  transport: SyncTransport;
  queue: MutationQueue;
  cursor: CursorStore;
  apply: ApplyCanonical;
}

const rowId = (row: Record<string, unknown>): string =>
  typeof row.id === "string" ? row.id : "";
const keyOf = (entity: string, row: Record<string, unknown>): string => `${entity}:${rowId(row)}`;

export class ReconcileEngine {
  constructor(private readonly deps: ReconcileDeps) {}

  async reconcile(): Promise<ReconcileResult> {
    const since = await this.deps.cursor.get();
    const pull = await this.deps.transport.pull(since);
    const pulled = await this.applyPull(pull.changes, this.pendingKeys());
    const replay = await this.replayQueue();
    await this.deps.cursor.set(pull.cursor);
    return { pulled, ...replay, cursor: pull.cursor };
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

  /** Spela upp kön (FIFO). accepted/rebased → applicera + ack; conflict → ytlägg + ack. */
  private async replayQueue(): Promise<Tally> {
    const tally: Tally = { pushed: 0, rebased: 0, replayed: 0, conflicts: [] };
    for (const m of [...this.deps.queue.pending()]) {
      if (isProcedureCall(m)) await this.replayProcedure(m, tally);
      else await this.replayRow(m, tally);
      await this.deps.queue.ack(m.mutationId);
    }
    return tally;
  }

  private async replayRow(m: QueuedMutation, tally: Tally): Promise<void> {
    const res = await this.deps.transport.push(m);
    if (res.status === "conflict") {
      tally.conflicts.push(omitUndefined({
        mutation: m, conflictClass: conflictClassOf(m.entity), reason: res.reason, current: res.current,
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
