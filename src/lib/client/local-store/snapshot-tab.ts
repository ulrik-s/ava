/**
 * `QueueSnapshotTab` (#1714) — flikens sida av snapshotets märken
 * (`snapshot-marks.ts`): vilka köposters rader flikens minne bär, och vilka
 * rader som ska läsas om från servern.
 *
 * Flikens minne bär raderna för de poster fliken själv köat, och för de poster
 * som var märkta i snapshotet den hydrerade. En post som låg i kön vid start
 * UTAN att vara märkt (en annan flik hade köat den men inte hunnit spara) finns
 * inte i minnet: den räknas som den andra flikens, så att dess rader bärs över.
 */

import type { RowRef } from "@/lib/server/data-store/in-memory/sync-transport";
import { refsOf } from "./canonical-restore";
import type { MutationQueue } from "./mutation-queue";
import type { ReconcileEngine } from "./reconcile-engine";
import type { SnapshotMarks, SnapshotTab } from "./snapshot-marks";

/** Motorns lista över rader som ska läsas om från servern. */
type Owing = Pick<ReconcileEngine, "restoreLater" | "owed">;

export class QueueSnapshotTab implements SnapshotTab {
  /** Poster i kön vid start vars rader det hydrerade snapshotet saknade. */
  private readonly absent = new Set<string>();
  /** Rader att läsa om, innan motorn finns (snapshotet hydreras före den). */
  private early: RowRef[] = [];
  private engine: Owing | null = null;

  constructor(private readonly queue: MutationQueue) {}

  /** Koppla motorn: raderna som väntat sedan hydreringen lämnas över. */
  bind(engine: Owing): void {
    this.engine = engine;
    engine.restoreLater(this.early);
    this.early = [];
  }

  marks(): SnapshotMarks {
    // En annan flik har avgjort posterna (#1402): raderna står kvar i minnet
    // tills nästa reconcile, och ska läsas om även efter en omstart.
    this.owe(this.queue.takeSettledElsewhere().flatMap(refsOf));
    const pending = this.queue.pending()
      .filter((e) => this.queue.holds(e.mutationId) && !this.absent.has(e.mutationId))
      .map((e) => ({ id: e.mutationId, refs: refsOf(e) }));
    return { pending, owed: [...this.early, ...(this.engine?.owed() ?? [])] };
  }

  position(mutationId: string): number | null {
    const index = this.queue.pending().findIndex((e) => e.mutationId === mutationId);
    return index < 0 ? null : index;
  }

  refresh(): Promise<void> {
    return this.queue.refresh();
  }

  adopt(stored: SnapshotMarks | null): void {
    if (!stored) return; // före #1714: snapshotet antas bära köns rader, som förut
    const marked = new Set(stored.pending.map((m) => m.id));
    for (const entry of this.queue.pending()) if (!marked.has(entry.mutationId)) this.absent.add(entry.mutationId);
    const settled = stored.pending.filter((m) => !this.queue.has(m.id)).flatMap((m) => m.refs);
    this.owe([...stored.owed, ...settled]);
  }

  private owe(refs: readonly RowRef[]): void {
    if (this.engine) this.engine.restoreLater(refs);
    else this.early.push(...refs);
  }
}
