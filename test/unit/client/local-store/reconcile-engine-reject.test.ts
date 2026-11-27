/**
 * `ReconcileEngine` — en avvisad köpost sparas innan den kvitteras (#1710, ADR 0037).
 *
 * Det som skyddas:
 *   - `onReject` anropas och inväntas FÖRE `queue.ack`, på varje väg där en
 *     post avvisas: radkonflikt, deterministiskt fel, uttömda omförsök och en
 *     avvisad procedur. Dör fliken mellan de två stegen ligger posten kvar i kön,
 *   - godtagna och ombaserade poster anropar den inte,
 *   - kastar den kvitteras inte posten: kön stannar där, och posten spelas
 *     upp igen nästa gång,
 *   - utan callback beter sig motorn som förut.
 */
import { describe, expect, it } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/client/local-store/cursor-store";
import { InMemoryMutationQueuePersistence, MutationQueue } from "@/lib/client/local-store/mutation-queue";
import { ReconcileEngine, type ConflictRecord, type ReconcileDeps } from "@/lib/client/local-store/reconcile-engine";
import { ReplayBackoff } from "@/lib/client/local-store/replay-backoff";
import type { ProcedureReplayResult, PulledChange, PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";

/** Ett tRPC-klientfel som servern svarat med (formen `TRPCClientError` har). */
function trpcError(code: string, httpStatus: number): Error {
  return Object.assign(new Error(code), { name: "TRPCClientError", data: { code, httpStatus } });
}

/** Vad servern gör med en post: svarar (rad eller procedur) eller kastar. */
type Step = PushResult | ProcedureReplayResult | Error;

class ScriptedTransport implements SyncTransport {
  /** Utfall per mutationId; utan utfall godtas posten. */
  script = new Map<string, Step>();

  pull(): Promise<PullResult> {
    return Promise.resolve({ changes: [], cursor: 7 });
  }
  rows(): Promise<PulledChange[]> {
    return Promise.resolve([]);
  }
  push(m: { mutationId: string; row: Record<string, unknown> }): Promise<PushResult> {
    return this.answer(m.mutationId, (step): step is PushResult => !("rows" in step), { status: "accepted", row: m.row });
  }
  pushProcedure(c: { mutationId: string }): Promise<ProcedureReplayResult> {
    return this.answer(c.mutationId, (step): step is ProcedureReplayResult => "rows" in step, { status: "accepted", rows: [] });
  }
  /** Postens utfall: det skriptade svaret (om det är av rätt sort), ett kastat fel, eller `accepted`. */
  private answer<T extends Exclude<Step, Error>>(id: string, fits: (step: Exclude<Step, Error>) => step is T, accepted: T): Promise<T> {
    const step = this.script.get(id);
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(step && fits(step) ? step : accepted);
  }
}

type OnReject = NonNullable<ReconcileDeps["onReject"]>;

/** Motorn med en logg över `onReject` och `ack`, i den ordning de sker. */
async function harness(onReject?: (log: string[]) => OnReject) {
  const log: string[] = [];
  const transport = new ScriptedTransport();
  const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
  const ack = queue.ack.bind(queue);
  queue.ack = async (id) => {
    log.push(`ack:${id}`);
    await ack(id);
  };
  const backoff = new ReplayBackoff({ maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 1000 }, () => 0);
  const engine = new ReconcileEngine({
    transport, queue, cursor: new InMemoryCursorStore(), apply: () => undefined, backoff,
    ...(onReject ? { onReject: onReject(log) } : {}),
  });
  const row = (id: string, entity = "timeEntry") => queue.enqueue({ entity, kind: "create", row: { id } }, { mutationId: id });
  const call = (id: string) => queue.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [] }, { mutationId: id });
  const ids = () => queue.pending().map((e) => e.mutationId);
  return { log, transport, engine, row, call, ids };
}

/** Sparar avvisningen i loggen — först efter en väntan, så att ordningen prövas. */
const saving = (log: string[]): OnReject => async (c: ConflictRecord) => {
  await new Promise((resolve) => { setTimeout(resolve, 1); });
  log.push(`reject:${c.mutation.mutationId}`);
};

const failing = (error: Error) => (): OnReject => () => Promise.reject(error);

describe("ReconcileEngine — avvisningen sparas innan posten kvitteras (#1710)", () => {
  it.each<[string, "row" | "call", Step]>([
    ["radkonflikt", "row", { status: "conflict", reason: "stale", current: { id: "a", version: 3 } }],
    ["deterministiskt fel", "row", trpcError("BAD_REQUEST", 400)],
    ["uttömda omförsök", "row", trpcError("INTERNAL_SERVER_ERROR", 500)],
    ["avvisad procedur", "call", { status: "rejected", code: "FORBIDDEN", reason: "Saknar behörighet.", rows: [] }],
  ])("%s → onReject inväntas, sedan ack", async (_label, kind, step) => {
    const h = await harness(saving);
    await h[kind]("a");
    await h.row("b");
    h.transport.script.set("a", step);
    const res = await h.engine.reconcile();
    expect(h.log).toEqual(["reject:a", "ack:a", "ack:b"]);
    expect(res.conflicts.map((c) => c.mutation.mutationId)).toEqual(["a"]);
    expect(res.blocked).toBeNull();
    expect(h.ids()).toEqual([]);
  });

  it("callbacken får postens ConflictRecord — samma som i resultatet", async () => {
    const seen: ConflictRecord[] = [];
    const h = await harness(() => (c) => { seen.push(c); });
    await h.row("a");
    h.transport.script.set("a", { status: "conflict", reason: "stale", current: { id: "a", version: 3 } });
    const res = await h.engine.reconcile();
    expect(seen).toEqual(res.conflicts);
    expect(seen[0]).toMatchObject({ reason: "stale", current: { id: "a", version: 3 }, mutation: { mutationId: "a" } });
  });

  it("godtagna och ombaserade poster anropar den inte", async () => {
    const h = await harness(saving);
    await h.row("a");
    await h.row("b");
    await h.call("c");
    h.transport.script.set("b", { status: "rebased", row: { id: "b", version: 4 } });
    const res = await h.engine.reconcile();
    expect(h.log).toEqual(["ack:a", "ack:b", "ack:c"]);
    expect(res).toMatchObject({ pushed: 2, rebased: 1, conflicts: [] });
  });

  it("kastar callbacken kvitteras inte posten: kön stannar där, och avvisningen står inte i resultatet", async () => {
    const error = new Error("IndexedDB är full");
    const h = await harness(failing(error));
    await h.row("a");
    await h.row("b");
    await h.row("c");
    h.transport.script.set("b", trpcError("FORBIDDEN", 403));
    const res = await h.engine.reconcile();
    expect(h.log).toEqual(["ack:a"]);
    expect(h.ids()).toEqual(["b", "c"]);
    expect(res.blocked).toEqual({ mutation: expect.objectContaining({ mutationId: "b" }), error, attempts: 0 });
    expect(res.conflicts).toEqual([]);
    // Kön stannade: cursorn flyttas inte.
    expect(res.cursor).toBe(0);
  });

  it("posten spelas upp igen nästa gång, och sparas då", async () => {
    let fail = true;
    const saved: string[] = [];
    const h = await harness(() => (c) => {
      if (fail) throw new Error("tillfälligt lagringsfel");
      saved.push(c.mutation.mutationId);
    });
    await h.call("a");
    h.transport.script.set("a", { status: "rejected", code: "FORBIDDEN", reason: "Saknar behörighet.", rows: [] });
    await h.engine.reconcile();
    expect(h.ids()).toEqual(["a"]);
    fail = false;
    const res = await h.engine.reconcile();
    expect(saved).toEqual(["a"]);
    expect(h.ids()).toEqual([]);
    expect(res.conflicts.map((c) => c.mutation.mutationId)).toEqual(["a"]);
    expect(res.cursor).toBe(7);
  });

  it("utan callback: avvisningen står i resultatet och posten kvitteras, som förut", async () => {
    const h = await harness();
    await h.row("a");
    await h.call("b");
    h.transport.script.set("a", trpcError("BAD_REQUEST", 400));
    h.transport.script.set("b", { status: "rejected", code: "FORBIDDEN", reason: "Saknar behörighet.", rows: [] });
    const res = await h.engine.reconcile();
    expect(h.log).toEqual(["ack:a", "ack:b"]);
    expect(res.conflicts.map((c) => c.mutation.mutationId)).toEqual(["a", "b"]);
    expect(res.blocked).toBeNull();
  });
});
