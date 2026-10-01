/**
 * `ReconcileEngine` — en avvisad ändring lämnar ingen spökrad (#1348).
 *
 * Det som skyddas:
 *   - radkonflikt MED serverns `current` → `current` skrivs lokalt,
 *   - radkonflikt UTAN `current`, och avvisningar som klienten själv klassar
 *     (deterministiskt fel, tillfälligt fel efter gränsen) → raderna hämtas
 *     med `rows` och skrivs lokalt (tombstone när raden inte finns),
 *   - en rad pullen hoppade (pending) går inte förlorad när cursorn flyttas,
 *   - en rad med en kvarvarande köpost rörs inte (dess lokala läge gäller),
 *   - går läget inte att hämta flyttas inte cursorn, och raderna försöks igen,
 *   - `retryable`: ja bara där ett nytt försök kan lyckas.
 */
import { describe, expect, it } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { InMemoryMutationQueuePersistence, MutationQueue, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import { ReconcileEngine, rowConflictRetryable } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { ReplayBackoff } from "@/lib/server/data-store/in-memory/replay-backoff";
import type {
  ProcedureReplayResult, PulledChange, PullResult, PushResult, RowRef, SyncTransport,
} from "@/lib/server/data-store/in-memory/sync-transport";

function trpcError(code: string, httpStatus: number, message = code): Error {
  return Object.assign(new Error(message), { name: "TRPCClientError", data: { code, httpStatus } });
}

type Step = PushResult | Error;

class Transport implements SyncTransport {
  pulled: PulledChange[] = [];
  pullCursor = 9;
  /** Serverns rader; saknas en rad svarar `rows` med en tombstone. */
  server = new Map<string, Record<string, unknown>>();
  steps = new Map<string, Step>();
  rowRequests: string[][] = [];
  rowsFail = false;

  async pull(): Promise<PullResult> {
    return { changes: this.pulled, cursor: this.pullCursor };
  }
  async rows(refs: readonly RowRef[]): Promise<PulledChange[]> {
    this.rowRequests.push(refs.map((r) => `${r.entity}:${r.id}`));
    if (this.rowsFail) throw new Error("Failed to fetch");
    return refs.map((r) => {
      const row = this.server.get(`${r.entity}:${r.id}`);
      return row ? { entity: r.entity, row } : { entity: r.entity, row: { id: r.id }, deleted: true };
    });
  }
  async push(m: { mutationId: string; row: Record<string, unknown> }): Promise<PushResult> {
    return this.outcome(m.mutationId) ?? { status: "accepted", row: { ...m.row, server: true } };
  }
  async pushProcedure(c: { mutationId: string }): Promise<ProcedureReplayResult> {
    this.outcome(c.mutationId);
    return { status: "accepted", rows: [] };
  }
  private outcome(id: string): PushResult | undefined {
    const step = this.steps.get(id);
    if (step instanceof Error) throw step;
    return step;
  }
}

async function harness(opts: { maxAttempts?: number } = {}) {
  const applied: string[] = [];
  const transport = new Transport();
  const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
  const cursor = new InMemoryCursorStore();
  const backoff = new ReplayBackoff({ maxAttempts: opts.maxAttempts ?? 3, baseDelayMs: 0, maxDelayMs: 0 }, () => 0);
  const engine = new ReconcileEngine({
    transport, queue, cursor, backoff,
    apply: (entity, row, deleted) => { applied.push(`${entity}:${String(row.id)}${deleted ? " (borta)" : ` ${JSON.stringify(row)}`}`); },
  });
  const update = (mutationId: string, entity: string, id: string) =>
    queue.enqueue({ entity, kind: "update", row: { id, lokal: true } }, { mutationId });
  return { applied, transport, queue, cursor, engine, update };
}

describe("ReconcileEngine — radkonflikter återställer serverns läge (#1348)", () => {
  it("konflikt med current → current skrivs lokalt; retryable för en rad radkön får skriva", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    h.transport.steps.set("a", { status: "conflict", reason: "stale", current: { id: "t1", version: 4 } });
    const res = await h.engine.reconcile();
    expect(h.applied).toEqual(['task:t1 {"id":"t1","version":4}']);
    expect(res.conflicts[0]).toMatchObject({ retryable: true, current: { version: 4 } });
    expect(res.restored).toBe(1);
  });

  it("procedurägd rad med current → current skrivs, men ett nytt försök avvisas igen", async () => {
    const h = await harness();
    await h.update("a", "timeEntry", "t1");
    h.transport.steps.set("a", { status: "conflict", reason: "procedurägd", current: { id: "t1", minutes: 30 } });
    const res = await h.engine.reconcile();
    expect(h.applied).toEqual(['timeEntry:t1 {"id":"t1","minutes":30}']);
    expect(res.conflicts[0]?.retryable).toBe(false);
  });

  it("konflikt utan current → raden hämtas; finns den inte hos byrån tas den bort lokalt", async () => {
    const h = await harness();
    await h.queue.enqueue({ entity: "contact", kind: "create", row: { id: "c1" } }, { mutationId: "a" });
    h.transport.steps.set("a", { status: "conflict", reason: "annan byrå" });
    const res = await h.engine.reconcile();
    expect(h.transport.rowRequests).toEqual([["contact:c1"]]);
    expect(h.applied).toEqual(["contact:c1 (borta)"]);
    expect(res.conflicts[0]?.retryable).toBe(false);
    expect(res.cursor).toBe(9);
  });
});

describe("ReconcileEngine — avvisningar klienten klassar återställer serverns läge (#1348)", () => {
  it("deterministiskt fel på en rad → serverns rad hämtas och skrivs; inte retryable", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    h.transport.server.set("task:t1", { id: "t1", title: "serverns" });
    h.transport.steps.set("a", trpcError("BAD_REQUEST", 400, "ogiltig"));
    const res = await h.engine.reconcile();
    expect(h.applied).toEqual(['task:t1 {"id":"t1","title":"serverns"}']);
    expect(res.conflicts[0]?.retryable).toBe(false);
  });

  it("deterministiskt fel på ett anrop → alla berörda rader hämtas (en skapad rad försvinner)", async () => {
    const h = await harness();
    await h.queue.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [{ entity: "timeEntry", id: "t1" }, { entity: "matter", id: "m1" }] }, { mutationId: "p" });
    h.transport.server.set("matter:m1", { id: "m1" });
    h.transport.steps.set("p", trpcError("PRECONDITION_FAILED", 412));
    const res = await h.engine.reconcile();
    expect(h.transport.rowRequests).toEqual([["timeEntry:t1", "matter:m1"]]);
    expect(h.applied).toEqual(["timeEntry:t1 (borta)", 'matter:m1 {"id":"m1"}']);
    expect(res.conflicts[0]).toMatchObject({ conflictClass: "surface", retryable: false });
  });

  it("tillfälligt fel efter gränsen → raden hämtas; retryable (posten nådde aldrig fram)", async () => {
    const h = await harness({ maxAttempts: 1 });
    await h.update("a", "task", "t1");
    h.transport.steps.set("a", trpcError("INTERNAL_SERVER_ERROR", 500));
    const res = await h.engine.reconcile();
    expect(h.applied).toEqual(["task:t1 (borta)"]);
    expect(res.conflicts[0]?.retryable).toBe(true);
  });
});

describe("ReconcileEngine — rader som hoppades i pullen går inte förlorade (#1348)", () => {
  it("pullen hoppade raden, posten avvisades utan läge → raden hämtas trots att cursorn flyttas", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    h.transport.pulled = [{ entity: "task", row: { id: "t1", title: "pullad" } }];
    h.transport.server.set("task:t1", { id: "t1", title: "nu" });
    h.transport.steps.set("a", trpcError("FORBIDDEN", 403));
    const res = await h.engine.reconcile();
    expect(res.pulled).toBe(0);
    expect(h.applied).toEqual(['task:t1 {"id":"t1","title":"nu"}']);
    expect(await h.cursor.get()).toBe(9);
  });

  it("pullen hoppade raden, posten godtogs → serverns svar räcker, inget hämtas", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    h.transport.pulled = [{ entity: "task", row: { id: "t1" } }];
    const res = await h.engine.reconcile();
    expect(h.transport.rowRequests).toEqual([]);
    expect(res.restored).toBe(0);
  });

  it("anropets berörda rader avgörs av serverns svar — inget hämtas", async () => {
    const h = await harness();
    await h.queue.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [{ entity: "timeEntry", id: "t1" }] }, { mutationId: "p" });
    h.transport.pulled = [{ entity: "timeEntry", row: { id: "t1" } }];
    await h.engine.reconcile();
    expect(h.transport.rowRequests).toEqual([]);
  });
});

describe("ReconcileEngine — ordning och kvarvarande köposter (#1348)", () => {
  it("en senare post för samma rad godtas → dess rad gäller, den avvisade återställs inte ovanpå", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    await h.update("b", "task", "t1");
    h.transport.steps.set("a", { status: "conflict", reason: "stale", current: { id: "t1", version: 2 } });
    const res = await h.engine.reconcile();
    expect(h.applied).toEqual(['task:t1 {"id":"t1","lokal":true,"server":true}']);
    expect(res.restored).toBe(0);
  });

  it("en kvarvarande köpost för raden (kön stannade) → raden rörs inte, cursorn står kvar", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    await h.update("b", "task", "t1");
    h.transport.steps.set("a", trpcError("BAD_REQUEST", 400));
    h.transport.steps.set("b", trpcError("SERVICE_UNAVAILABLE", 503));
    const res = await h.engine.reconcile();
    expect(res.blocked?.mutation.mutationId).toBe("b");
    expect(h.transport.rowRequests).toEqual([]);
    expect(h.applied).toEqual([]);
    expect(await h.cursor.get()).toBe(0);
  });

  it("en avvisad post vars rad senare avvisas med current → det senaste läget gäller", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    await h.update("b", "task", "t1");
    h.transport.steps.set("a", trpcError("BAD_REQUEST", 400));
    h.transport.steps.set("b", { status: "conflict", reason: "stale", current: { id: "t1", version: 7 } });
    await h.engine.reconcile();
    expect(h.transport.rowRequests).toEqual([]);
    expect(h.applied).toEqual(['task:t1 {"id":"t1","version":7}']);
  });
});

describe("ReconcileEngine — läget går inte att hämta (#1348)", () => {
  it("nätfel vid hämtningen → cursorn står kvar; nästa reconcile hämtar raderna igen", async () => {
    const h = await harness();
    await h.update("a", "task", "t1");
    h.transport.steps.set("a", trpcError("BAD_REQUEST", 400));
    h.transport.rowsFail = true;
    const first = await h.engine.reconcile();
    expect(first.conflicts).toHaveLength(1); // avvisningen sparas ändå
    expect(first.restored).toBe(0);
    expect(await h.cursor.get()).toBe(0);

    h.transport.rowsFail = false;
    const second = await h.engine.reconcile();
    expect(second.restored).toBe(1);
    expect(h.applied).toEqual(["task:t1 (borta)"]);
    expect(h.transport.rowRequests).toEqual([["task:t1"], ["task:t1"]]);
    expect(await h.cursor.get()).toBe(9);

    await h.engine.reconcile();
    expect(h.transport.rowRequests).toHaveLength(2); // klart — hämtas inte igen
  });
});

describe("rowConflictRetryable", () => {
  const row = (entity: string): QueueEntry => ({ mutationId: "m", entity, kind: "update", row: { id: "x" }, enqueuedAt: 0 });
  it("bara en versionskonflikt (current) på en rad radkön får skriva", () => {
    expect(rowConflictRetryable(row("task"), { id: "x" })).toBe(true);
    expect(rowConflictRetryable(row("task"), undefined)).toBe(false);
    expect(rowConflictRetryable(row("invoice"), { id: "x" })).toBe(false);
    const call: QueueEntry = { type: "procedure", mutationId: "p", path: "timeEntry.update", input: {}, codeVersion: "v", touches: [], enqueuedAt: 0 };
    expect(rowConflictRetryable(call, { id: "x" })).toBe(false);
  });
});
