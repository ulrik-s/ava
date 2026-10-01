/**
 * `ReconcileEngine` — en trasig köpost blockerar inte kön (#1353).
 *
 * Det som skyddas:
 *   - ett deterministiskt fel (BAD_REQUEST, zod, …) avvisar posten direkt —
 *     den hamnar bland konflikterna (de avvisade ändringarna) och kön fortsätter,
 *   - ett kanske-tillfälligt fel (500) försöks igen med backoff, i ordning —
 *     posterna efter den rörs inte, cursorn flyttas inte — och avvisas efter
 *     ett begränsat antal försök så att resten av kön kommer fram,
 *   - ett fel som inte beror på posten (nätet, 401, 503) stoppar kön utan att
 *     räknas: posten avvisas aldrig för att nätet är borta,
 *   - ordningen kastas aldrig om: en post som byggde på en avvisad post
 *     spelas upp efter den (och avvisas av servern i sin tur).
 */
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { InMemoryMutationQueuePersistence, MutationQueue, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import { ReconcileEngine } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { ReplayBackoff } from "@/lib/server/data-store/in-memory/replay-backoff";
import type { ProcedureReplayResult, PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";

/** Ett tRPC-klientfel som servern svarat med (formen `TRPCClientError` har). */
function trpcError(code: string, httpStatus: number, message = code): Error {
  return Object.assign(new Error(message), { name: "TRPCClientError", data: { code, httpStatus } });
}

/** Ett tRPC-klientfel utan svar — nätet nås inte. */
const unreachable = (): Error => Object.assign(new Error("Failed to fetch"), { name: "TRPCClientError" });

type Outcome = Error | "ok";

class ScriptedTransport implements SyncTransport {
  /** Utfall per mutationId, i tur och ordning; sista upprepas. */
  script = new Map<string, Outcome[]>();
  calls: string[] = [];
  pullCursor = 7;

  async pull(): Promise<PullResult> {
    return { changes: [], cursor: this.pullCursor };
  }
  async push(m: { mutationId: string; row: Record<string, unknown> }): Promise<PushResult> {
    this.next(m.mutationId);
    return { status: "accepted", row: m.row };
  }
  async pushProcedure(c: { mutationId: string }): Promise<ProcedureReplayResult> {
    this.next(c.mutationId);
    return { status: "accepted", rows: [] };
  }
  private next(id: string): void {
    this.calls.push(id);
    const steps = this.script.get(id) ?? [];
    const step = steps.length > 1 ? steps.shift() : steps[0];
    if (step && step !== "ok") throw step;
  }
}

async function harness() {
  let now = 1_000_000;
  const clock = { advance: (ms: number) => { now += ms; } };
  const transport = new ScriptedTransport();
  const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
  const cursor = new InMemoryCursorStore();
  const backoff = new ReplayBackoff({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 1500 }, () => now);
  const engine = new ReconcileEngine({ transport, queue, cursor, apply: () => undefined, backoff });
  const row = (id: string, entity = "timeEntry") => queue.enqueue({ entity, kind: "create", row: { id } }, { mutationId: id });
  const call = (id: string) => queue.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [] }, { mutationId: id });
  const ids = () => queue.pending().map((e: QueueEntry) => e.mutationId);
  return { transport, queue, cursor, engine, clock, row, call, ids };
}

describe("ReconcileEngine — deterministiska fel avvisas och kön fortsätter (#1353)", () => {
  it("BAD_REQUEST på en radpost → konflikt med serverns besked, ackad; nästa post spelas upp", async () => {
    const h = await harness();
    await h.row("a", "invoice");
    await h.row("b");
    h.transport.script.set("a", [trpcError("BAD_REQUEST", 400, "ogiltigt belopp")]);
    const res = await h.engine.reconcile();
    expect(res.conflicts).toEqual([{ mutation: expect.objectContaining({ mutationId: "a" }), conflictClass: "surface", reason: "Servern avvisade ändringen: ogiltigt belopp" }]);
    expect(res.pushed).toBe(1);
    expect(res.blocked).toBeNull();
    expect(h.ids()).toEqual([]);
    expect(await h.cursor.get()).toBe(7);
  });

  it("ett zod-fel avvisas likadant; en radposts klass följer entiteten", async () => {
    const h = await harness();
    await h.row("a", "matter");
    const parsed = z.object({ id: z.string() }).safeParse({});
    if (parsed.success) throw new Error("förväntade ett zod-fel");
    h.transport.script.set("a", [parsed.error]);
    const res = await h.engine.reconcile();
    expect(res.conflicts[0]).toMatchObject({ conflictClass: "lww", reason: expect.stringMatching(/^Servern avvisade ändringen: /) });
  });

  it("ordningen kastas aldrig om: A avvisas, B (som byggde på A) spelas upp efter och avvisas av servern", async () => {
    const h = await harness();
    await h.call("a");
    await h.call("b");
    h.transport.script.set("a", [trpcError("CONFLICT", 409, "ärendet finns redan")]);
    h.transport.script.set("b", [trpcError("NOT_FOUND", 404, "ärendet finns inte")]);
    const res = await h.engine.reconcile();
    expect(h.transport.calls).toEqual(["a", "b"]);
    expect(res.conflicts.map((c) => [c.mutation.mutationId, c.conflictClass])).toEqual([["a", "surface"], ["b", "surface"]]);
    expect(h.ids()).toEqual([]);
  });
});

describe("ReconcileEngine — kanske-tillfälliga fel försöks igen, begränsat (#1353)", () => {
  it("500 → kön stannar vid posten; posterna efter rörs inte; cursorn flyttas inte", async () => {
    const h = await harness();
    await h.row("a");
    await h.row("b");
    const err = trpcError("INTERNAL_SERVER_ERROR", 500);
    h.transport.script.set("a", [err]);
    const res = await h.engine.reconcile();
    expect(res.blocked).toEqual({ mutation: expect.objectContaining({ mutationId: "a" }), error: err, attempts: 1 });
    expect(h.transport.calls).toEqual(["a"]);
    expect(h.ids()).toEqual(["a", "b"]);
    expect(await h.cursor.get()).toBe(0);
    expect(res.cursor).toBe(0);
  });

  it("under backoff anropas inte servern — det senaste felet står kvar", async () => {
    const h = await harness();
    await h.row("a");
    const err = trpcError("INTERNAL_SERVER_ERROR", 500);
    h.transport.script.set("a", [err]);
    await h.engine.reconcile();
    const res = await h.engine.reconcile();
    expect(h.transport.calls).toEqual(["a"]);
    expect(res.blocked).toMatchObject({ error: err, attempts: 1 });
  });

  it("efter backoff försöks posten igen; lyckas den spelas resten upp och räkningen glöms", async () => {
    const h = await harness();
    await h.row("a");
    await h.row("b");
    h.transport.script.set("a", [trpcError("INTERNAL_SERVER_ERROR", 500), "ok"]);
    await h.engine.reconcile();
    h.clock.advance(1000);
    const res = await h.engine.reconcile();
    expect(res.blocked).toBeNull();
    expect(res.pushed).toBe(2);
    expect(h.transport.calls).toEqual(["a", "a", "b"]);
    expect(await h.cursor.get()).toBe(7);
  });

  it("efter gränsen avvisas posten med antalet försök, och kön fortsätter", async () => {
    const h = await harness();
    await h.row("a");
    await h.row("b");
    h.transport.script.set("a", [trpcError("INTERNAL_SERVER_ERROR", 500, "Internal Server Error")]);
    await h.engine.reconcile(); // försök 1 → vänta 1000
    h.clock.advance(1000);
    const second = await h.engine.reconcile(); // försök 2 → vänta 1500 (taket)
    expect(second.blocked?.attempts).toBe(2);
    h.clock.advance(1499);
    await h.engine.reconcile(); // fortfarande backoff
    expect(h.transport.calls).toEqual(["a", "a"]);
    h.clock.advance(1);
    const res = await h.engine.reconcile(); // försök 3 = gränsen
    expect(res.conflicts).toEqual([{
      mutation: expect.objectContaining({ mutationId: "a" }), conflictClass: "append",
      reason: "Ändringen nådde inte servern efter 3 försök: Internal Server Error",
    }]);
    expect(res.blocked).toBeNull();
    expect(h.transport.calls).toEqual(["a", "a", "a", "b"]);
    expect(h.ids()).toEqual([]);
  });

  it("ett okänt fel (inget tRPC-svar, inget nätfel) räknas också mot gränsen", async () => {
    const h = await harness();
    await h.call("a");
    h.transport.script.set("a", [new TypeError("x is undefined")]);
    const res = await h.engine.reconcile();
    expect(res.blocked?.attempts).toBe(1);
  });
});

describe("ReconcileEngine — fel som inte beror på posten stoppar kön utan att räknas (#1353)", () => {
  it.each([
    ["nätet nås inte", unreachable()],
    ["401", trpcError("UNAUTHORIZED", 401)],
    ["503 (servern äldre än köformatet)", trpcError("SERVICE_UNAVAILABLE", 503)],
  ])("%s → posten ligger kvar och avvisas aldrig, hur många gånger det än händer", async (_label, err) => {
    const h = await harness();
    await h.row("a");
    await h.row("b");
    h.transport.script.set("a", [err]);
    for (let i = 0; i < 5; i++) {
      const res = await h.engine.reconcile();
      expect(res.blocked).toEqual({ mutation: expect.objectContaining({ mutationId: "a" }), error: err, attempts: 0 });
      expect(res.conflicts).toEqual([]);
      h.clock.advance(10_000);
    }
    expect(h.ids()).toEqual(["a", "b"]);
    expect(h.transport.calls).toEqual(["a", "a", "a", "a", "a"]);
  });

  it("avvisningar före stoppet följer med i resultatet (de är redan ackade)", async () => {
    const h = await harness();
    await h.row("a");
    await h.row("b");
    h.transport.script.set("a", [trpcError("FORBIDDEN", 403)]);
    h.transport.script.set("b", [unreachable()]);
    const res = await h.engine.reconcile();
    expect(res.conflicts.map((c) => c.mutation.mutationId)).toEqual(["a"]);
    expect(res.blocked?.mutation.mutationId).toBe("b");
    expect(h.ids()).toEqual(["b"]);
  });
});

describe("ReconcileEngine — standardbackoff", () => {
  it("utan injicerad backoff används standardgränsen (ett 500 blockerar, avvisar inte)", async () => {
    const transport = new ScriptedTransport();
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue({ entity: "timeEntry", kind: "create", row: { id: "a" } }, { mutationId: "a" });
    transport.script.set("a", [trpcError("INTERNAL_SERVER_ERROR", 500)]);
    const engine = new ReconcileEngine({ transport, queue, cursor: new InMemoryCursorStore(), apply: () => undefined });
    const res = await engine.reconcile();
    expect(res.blocked?.attempts).toBe(1);
    expect(res.conflicts).toEqual([]);
  });
});
