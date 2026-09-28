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
  /** Radpost (radkön). Saknas på poster persisterade före #1265 — de är rader. */
  type?: "row";
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

/** En rad som ett köat procedur-anrop skrev lokalt (för att läsa tillbaka serverns läge). */
export interface ProcedureTouch {
  entity: string;
  id: string;
}

/**
 * Ett köat procedur-anrop (#1265, ADR 0037): servern kör om `path(input)`
 * auktoritativt med samma `appRouter`. Klientens lokala resultat är bara
 * optimistiskt — `touches` säger vilka rader som ska ersättas av serverns läge.
 */
export interface QueuedProcedureCall {
  type: "procedure";
  mutationId: string;
  /** tRPC-sökvägen, t.ex. `timeEntry.create` (se `QUEUED_PROCEDURES`). */
  path: string;
  input: Record<string, unknown>;
  /** Klientkodens version när anropet köades (för migrering, #1247/#1269). */
  codeVersion: string;
  touches: ProcedureTouch[];
  enqueuedAt: number;
}

/** En post i kön: en färdig rad eller ett procedur-anrop. */
export type QueueEntry = QueuedMutation | QueuedProcedureCall;

/** Är posten ett procedur-anrop (och inte en rad)? */
export function isProcedureCall(entry: QueueEntry): entry is QueuedProcedureCall {
  return entry.type === "procedure";
}

/** Klientkodens version — deploy-sha:n när den finns (samma som demo-cachens nyckel). */
export const SYNC_CODE_VERSION = process.env.NEXT_PUBLIC_DEMO_VERSION || "dev";

export interface MutationQueuePersistence {
  load(): Promise<QueueEntry[]>;
  save(items: readonly QueueEntry[]): Promise<void>;
}

/** In-memory-persistens (tester/demo) — djupkopierar för att undvika delad referens. */
export class InMemoryMutationQueuePersistence implements MutationQueuePersistence {
  constructor(private items: QueueEntry[] = []) {}
  async load(): Promise<QueueEntry[]> {
    return structuredClone(this.items);
  }
  async save(items: readonly QueueEntry[]): Promise<void> {
    this.items = structuredClone([...items]);
  }
}

/** IndexedDB-persistens — hela kön under en nyckel via `IdbKv`. */
export class IndexedDbMutationQueuePersistence implements MutationQueuePersistence {
  private readonly kv: IdbKv;
  constructor(
    factory: IDBFactory = globalThis.indexedDB,
    dbName = "ava-mutation-queue",
  ) {
    this.kv = new IdbKv(factory, dbName, "queue");
  }
  async load(): Promise<QueueEntry[]> {
    return (await this.kv.get<QueueEntry[]>("pending")) ?? [];
  }
  async save(items: readonly QueueEntry[]): Promise<void> {
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

/** Val för `enqueueProcedure`. */
export interface EnqueueProcedureOpts {
  mutationId?: string;
  now?: number;
  codeVersion?: string;
}

export class MutationQueue {
  private items: QueueEntry[] = [];

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
    const existing = this.items.find((m): m is QueuedMutation => m.mutationId === mutationId && !isProcedureCall(m));
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

  /** Köa ett procedur-anrop sist (#1265). Idempotent på `mutationId`. */
  async enqueueProcedure(
    call: Pick<QueuedProcedureCall, "path" | "input" | "touches">,
    opts: EnqueueProcedureOpts = {},
  ): Promise<QueuedProcedureCall> {
    const mutationId = opts.mutationId ?? uuidv7(opts.now);
    const existing = this.items.find((m): m is QueuedProcedureCall => m.mutationId === mutationId && isProcedureCall(m));
    if (existing) return existing;
    const item: QueuedProcedureCall = {
      type: "procedure",
      mutationId,
      path: call.path,
      input: call.input,
      codeVersion: opts.codeVersion ?? SYNC_CODE_VERSION,
      touches: call.touches,
      enqueuedAt: opts.now ?? Date.now(),
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  /** Köposterna i FIFO-ordning (för uppspelning). */
  pending(): readonly QueueEntry[] {
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

  /** Ersätt hela kön (id-reparation vid uppstart, se legacy-id-repair.ts). */
  async replaceAll(items: readonly QueueEntry[]): Promise<void> {
    this.items = [...items];
    await this.persist();
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
