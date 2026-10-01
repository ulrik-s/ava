/**
 * `ReconcileEngine` — uppspelning av procedur-anrop (#1265, ADR 0037).
 *
 * Servern kör anropet auktoritativt och svarar med de berörda radernas
 * kanoniska läge. Klienten kastar sitt optimistiska läge och tar serverns —
 * även när servern avvisar (då ytläggs avvisningen som konflikt, och en rad
 * klienten skapat men servern vägrat försvinner i stället för att leva kvar).
 */
import { describe, expect, it } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { InMemoryMutationQueuePersistence, MutationQueue, type QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { ReconcileEngine, type ApplyCanonical } from "@/lib/server/data-store/in-memory/reconcile-engine";
import type { ProcedureReplayResult, PulledChange, PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";

class FakeTransport implements SyncTransport {
  pulls: PullResult = { changes: [], cursor: 0 };
  replayed: QueuedProcedureCall[] = [];
  replayImpl: (c: QueuedProcedureCall) => Promise<ProcedureReplayResult> = async (c) => ({
    status: "accepted", rows: c.touches.map((t) => ({ entity: t.entity, row: { id: t.id, server: true } })),
  });
  async pull(): Promise<PullResult> { return this.pulls; }
  rowRequests = 0;
  async rows(): Promise<PulledChange[]> { this.rowRequests++; return []; }
  async push(m: { row: Record<string, unknown> }): Promise<PushResult> { return { status: "accepted", row: m.row }; }
  async pushProcedure(c: QueuedProcedureCall): Promise<ProcedureReplayResult> {
    this.replayed.push(c);
    return this.replayImpl(c);
  }
}

async function harness() {
  const applied: Array<{ entity: string; row: Record<string, unknown>; deleted: boolean }> = [];
  const apply: ApplyCanonical = (entity, row, deleted) => { applied.push({ entity, row, deleted }); };
  const transport = new FakeTransport();
  const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
  const engine = new ReconcileEngine({ transport, queue, cursor: new InMemoryCursorStore(), apply });
  return { applied, transport, queue, engine };
}

const touch = (id: string) => ({ entity: "timeEntry", id });

describe("ReconcileEngine — procedur-anrop", () => {
  it("accepted → serverns rader appliceras, posten ackas, räknas som pushed", async () => {
    const h = await harness();
    await h.queue.enqueueProcedure({ path: "timeEntry.create", input: { id: "t1" }, touches: [touch("t1")] }, { mutationId: "p1" });
    const res = await h.engine.reconcile();
    expect(h.transport.replayed.map((c) => c.mutationId)).toEqual(["p1"]);
    expect(h.applied).toEqual([{ entity: "timeEntry", row: { id: "t1", server: true }, deleted: false }]);
    expect(res.pushed).toBe(1);
    expect(res.replayed).toBe(1);
    expect(h.queue.size()).toBe(0);
  });

  it("rejected → konflikt med serverns skäl; serverns läge (tombstone) ersätter det optimistiska", async () => {
    const h = await harness();
    h.transport.replayImpl = async () => ({
      status: "rejected", code: "NOT_FOUND", reason: "Tidsposten finns inte längre.",
      rows: [{ entity: "timeEntry", row: { id: "t1" }, deleted: true }],
    });
    await h.queue.enqueueProcedure({ path: "timeEntry.update", input: { id: "t1" }, touches: [touch("t1")] }, { mutationId: "p1" });
    const res = await h.engine.reconcile();
    expect(res.conflicts).toHaveLength(1);
    // Servern har sparat avvisningen: samma anrop avvisas igen (#1348).
    expect(res.conflicts[0]).toMatchObject({ reason: "Tidsposten finns inte längre.", conflictClass: "surface", retryable: false });
    expect(h.applied).toEqual([{ entity: "timeEntry", row: { id: "t1" }, deleted: true }]);
    expect(h.transport.rowRequests).toBe(0); // serverns svar bar redan raderna
    expect(res.replayed).toBe(1);
    expect(h.queue.size()).toBe(0);
  });

  it("pull hoppar rader som ett ej uppspelat anrop berör (det optimistiska läget står kvar tills servern svarat)", async () => {
    const h = await harness();
    let appliedBeforeReplay: unknown[] = [];
    h.transport.replayImpl = async () => {
      appliedBeforeReplay = h.applied.map((a) => a.row.id);
      return { status: "accepted", rows: [] };
    };
    await h.queue.enqueueProcedure({ path: "timeEntry.update", input: { id: "t1" }, touches: [touch("t1")] });
    h.transport.pulls = { changes: [{ entity: "timeEntry", row: { id: "t1", old: true } }, { entity: "matter", row: { id: "m1" } }], cursor: 3 };
    await h.engine.reconcile();
    expect(appliedBeforeReplay).toEqual(["m1"]);
  });

  it("fel under uppspelning → posten ligger kvar (inget ack), felet följer med i resultatet (#1353)", async () => {
    const h = await harness();
    const err = new Error("Failed to fetch");
    h.transport.replayImpl = async () => { throw err; };
    await h.queue.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [] }, { mutationId: "p1" });
    const res = await h.engine.reconcile();
    expect(res.blocked).toMatchObject({ mutation: { mutationId: "p1" }, error: err });
    expect(h.queue.size()).toBe(1);
  });

  it("rader och anrop spelas upp i köordning", async () => {
    const h = await harness();
    const order: string[] = [];
    h.transport.push = async (m) => { order.push(`rad:${String(m.row.id)}`); return { status: "accepted", row: m.row }; };
    h.transport.replayImpl = async (c) => { order.push(`anrop:${c.path}`); return { status: "accepted", rows: [] }; };
    await h.queue.enqueue({ entity: "matter", kind: "create", row: { id: "m1" } });
    await h.queue.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [] });
    await h.queue.enqueue({ entity: "contact", kind: "create", row: { id: "c1" } });
    await h.engine.reconcile();
    expect(order).toEqual(["rad:m1", "anrop:timeEntry.create", "rad:c1"]);
  });
});
