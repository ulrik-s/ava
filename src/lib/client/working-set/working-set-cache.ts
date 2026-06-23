/**
 * `WorkingSetCache` (#418, ADR 0022) — koordinerar prefetch + on-demand-hämtning
 * + LRU-budget för offline-klientens ärende-cache. Komponerar `computeWorkingSet`
 * (vad som ska hållas) + `LruBudget` (vad som ska vräkas).
 *
 * Transport-agnostisk: lagrings-I/O injiceras (`loadMatter`/`evictMatter`) så
 * koordinatorn kan testas med fakes och wire:as mot `CachingSyncDataStore` (#415)
 * när server-first-backenden aktiveras (#419).
 */

import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { LruBudget } from "./lru-budget";
import { computeWorkingSet, type WorkingSet, type WorkingSetInput } from "./working-set";

export interface WorkingSetCacheDeps {
  /** Max antal ärenden i den lokala cachen. */
  budget: number;
  /** Hämta ett ärendes subträd till lokal store (prefetch/on-demand). */
  loadMatter: (matterId: MatterId) => Promise<void>;
  /** Vräk ett ärendes subträd ur lokal store. */
  evictMatter: (matterId: MatterId) => Promise<void>;
  /** Ärenden med icke-uppspelad lokal mutation (vräks ALDRIG, ADR 0017). */
  pendingMatterIds?: () => ReadonlySet<MatterId>;
}

export class WorkingSetCache {
  private readonly lru: LruBudget;
  private pinned: ReadonlySet<string> = new Set();

  constructor(private readonly deps: WorkingSetCacheDeps) {
    this.lru = new LruBudget(deps.budget);
  }

  /** Förhämta working-set:en vid login/online. Returnerar de hämtade ärende-id:na. */
  async prefetch(input: Omit<WorkingSetInput, "budget">): Promise<string[]> {
    const ws: WorkingSet = computeWorkingSet({ ...input, budget: this.deps.budget });
    this.pinned = ws.pinned;
    for (const id of ws.matterIds) {
      await this.deps.loadMatter(asId<"MatterId">(id));
      this.lru.touch(id);
    }
    await this.enforceBudget();
    return ws.matterIds;
  }

  /** Öppna ett ärende — hämtar on-demand om det är utanför cachen, touch:ar LRU. */
  async openMatter(matterId: MatterId): Promise<void> {
    if (!this.lru.has(matterId)) await this.deps.loadMatter(matterId);
    this.lru.touch(matterId);
    await this.enforceBudget();
  }

  /** Antal ärenden i cachen. */
  size(): number {
    return this.lru.size();
  }

  /** Vräk LRU-ärenden över budgeten (pinnade + pending undantagna). */
  private async enforceBudget(): Promise<void> {
    const pins = new Set(this.pinned);
    for (const id of this.deps.pendingMatterIds?.() ?? []) pins.add(id);
    for (const id of this.lru.overflow(pins)) {
      await this.deps.evictMatter(asId<"MatterId">(id));
      this.lru.forget(id);
    }
  }
}
