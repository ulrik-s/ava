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
import type { MutationQueue, QueuedMutation } from "./mutation-queue";
import type { PulledChange, SyncTransport } from "./sync-transport";

/** Tyst skrivning av en kanonisk server-rad till lokal store (utan att köa om). */
export type ApplyCanonical = (
  entity: string,
  row: Record<string, unknown>,
  deleted: boolean,
) => void | Promise<void>;

export interface ConflictRecord {
  mutation: QueuedMutation;
  conflictClass: ConflictClass;
  reason: string;
  current?: Record<string, unknown>;
}

export interface ReconcileResult {
  pulled: number;
  pushed: number;
  rebased: number;
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

  private pendingKeys(): Set<string> {
    return new Set(this.deps.queue.pending().map((m) => keyOf(m.entity, m.row)));
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
  private async replayQueue(): Promise<{ pushed: number; rebased: number; conflicts: ConflictRecord[] }> {
    let pushed = 0;
    let rebased = 0;
    const conflicts: ConflictRecord[] = [];
    for (const m of [...this.deps.queue.pending()]) {
      const res = await this.deps.transport.push(m);
      if (res.status === "conflict") {
        conflicts.push(omitUndefined({
          mutation: m, conflictClass: conflictClassOf(m.entity), reason: res.reason, current: res.current,
        }) as ConflictRecord);
      } else {
        await this.deps.apply(m.entity, res.row, false);
        if (res.status === "rebased") rebased++;
        else pushed++;
      }
      await this.deps.queue.ack(m.mutationId);
    }
    return { pushed, rebased, conflicts };
  }
}
