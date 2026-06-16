/**
 * `MutationQueue` (#413, ADR 0017) — den optimistiska mutations-kön i offline-
 * klienten. Mutationer appliceras lokalt direkt (av `LocalStore`) och köas här
 * för uppspelning mot servern vid reconnect (reconcile-motorn #414).
 *
 * Varje köpost bär ett klient-genererat **UUIDv7** (`mutationId`) — tidsordnat
 * (ADR 0003) och idempotent: re-enqueue av samma id är en no-op, och
 * uppspelning kan dedupa säkert. Köordningen bevaras (FIFO).
 *
 * Kön är persistens-agnostisk (`MutationQueuePersistence`-port) → IndexedDB i
 * browsern, in-memory i tester/demo.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";
import { uuidv7 } from "@/lib/shared/uuid";
import { IdbKv } from "./idb-kv";
import type { MutationEvent, MutationKind } from "./writable-delegate";

export interface QueuedMutation {
  /** Klient-genererat UUIDv7 — dedupe-nyckel + idempotent uppspelning. */
  mutationId: string;
  entity: string;
  kind: MutationKind;
  /** Raden efter mutationen (bär sitt eget UUIDv7 `id` → server-upsert). */
  row: Record<string, unknown>;
  /** Föregående rad (update/delete) — för rollback/konflikt. */
  previous?: Record<string, unknown>;
  /** Observerad `version` vid mutationen (ADR 0017 optimistisk concurrency). */
  baseVersion?: number;
  enqueuedAt: number;
}

export interface MutationQueuePersistence {
  load(): Promise<QueuedMutation[]>;
  save(items: readonly QueuedMutation[]): Promise<void>;
}

/** In-memory-persistens (tester/demo) — djupkopierar för att undvika delad referens. */
export class InMemoryMutationQueuePersistence implements MutationQueuePersistence {
  constructor(private items: QueuedMutation[] = []) {}
  async load(): Promise<QueuedMutation[]> {
    return structuredClone(this.items);
  }
  async save(items: readonly QueuedMutation[]): Promise<void> {
    this.items = structuredClone([...items]);
  }
}

/** IndexedDB-persistens — hela kön under en nyckel via `IdbKv`. */
export class IndexedDbMutationQueuePersistence implements MutationQueuePersistence {
  private readonly kv: IdbKv;
  constructor(
    factory: IDBFactory = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB,
    dbName = "ava-mutation-queue",
  ) {
    this.kv = new IdbKv(factory, dbName, "queue");
  }
  async load(): Promise<QueuedMutation[]> {
    return (await this.kv.get<QueuedMutation[]>("pending")) ?? [];
  }
  async save(items: readonly QueuedMutation[]): Promise<void> {
    await this.kv.put("pending", [...items]);
  }
}

export interface EnqueueOpts {
  /** Explicit mutationId för idempotent enqueue (annars genereras UUIDv7). */
  mutationId?: string;
  baseVersion?: number;
  /** Injicerad tidsstämpel (deterministiska tester). */
  now?: number;
}

export class MutationQueue {
  private items: QueuedMutation[] = [];

  constructor(private readonly persistence?: MutationQueuePersistence) {}

  /** Skapa en kö och hydrera den ur persistensen (om någon). */
  static async hydrate(persistence?: MutationQueuePersistence): Promise<MutationQueue> {
    const q = new MutationQueue(persistence);
    if (persistence) q.items = await persistence.load();
    return q;
  }

  /** Köa en mutation sist. Idempotent på `mutationId` (re-enqueue → no-op). */
  async enqueue(event: MutationEvent<Record<string, unknown>>, opts: EnqueueOpts = {}): Promise<QueuedMutation> {
    const mutationId = opts.mutationId ?? uuidv7(opts.now);
    const existing = this.items.find((m) => m.mutationId === mutationId);
    if (existing) return existing;
    const item = omitUndefined({
      mutationId,
      entity: event.entity,
      kind: event.kind,
      row: event.row,
      previous: event.previous,
      baseVersion: opts.baseVersion,
      enqueuedAt: opts.now ?? Date.now(),
    }) as QueuedMutation;
    this.items.push(item);
    await this.persist();
    return item;
  }

  /** Köposterna i FIFO-ordning (för uppspelning). */
  pending(): readonly QueuedMutation[] {
    return this.items;
  }

  size(): number {
    return this.items.length;
  }

  has(mutationId: string): boolean {
    return this.items.some((m) => m.mutationId === mutationId);
  }

  /** Ta bort en post efter server-bekräftelse. */
  async ack(mutationId: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((m) => m.mutationId !== mutationId);
    if (this.items.length !== before) await this.persist();
  }

  async clear(): Promise<void> {
    if (this.items.length === 0) return;
    this.items = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.persistence?.save(this.items);
  }
}
