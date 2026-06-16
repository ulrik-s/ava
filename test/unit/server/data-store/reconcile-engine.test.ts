/**
 * ReconcileEngine (ADR 0017, #414) — pull→apply→replay→advance:
 * applicering av kanoniska rader, hopp över pending-rader, replay
 * (accepted/rebased/conflict), konflikt-låda och cursor-advance.
 */

import { describe, it, expect } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";
import { MutationQueue, InMemoryMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import { ReconcileEngine, type ApplyCanonical } from "@/lib/server/data-store/in-memory/reconcile-engine";
import type { PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";

const ev = (entity: string, id: string, extra: Record<string, unknown> = {}): MutationEvent<Record<string, unknown>> => ({
  entity, kind: "create", row: { id, ...extra },
});

class FakeTransport implements SyncTransport {
  pulls: PullResult = { changes: [], cursor: 0 };
  pushResults = new Map<string, PushResult>();
  pushed: string[] = [];
  async pull(): Promise<PullResult> {
    return this.pulls;
  }
  async push(m: { mutationId: string; row: Record<string, unknown> }): Promise<PushResult> {
    this.pushed.push(m.mutationId);
    return this.pushResults.get(m.mutationId) ?? { status: "accepted", row: m.row };
  }
}

function harness() {
  const applied: Array<{ entity: string; row: Record<string, unknown>; deleted: boolean }> = [];
  const apply: ApplyCanonical = (entity, row, deleted) => { applied.push({ entity, row, deleted }); };
  const transport = new FakeTransport();
  const cursor = new InMemoryCursorStore();
  return { applied, apply, transport, cursor };
}

describe("ReconcileEngine — pull", () => {
  it("applicerar kanoniska rader och avancerar cursor", async () => {
    const h = harness();
    h.transport.pulls = { changes: [{ entity: "matter", row: { id: "m1", title: "T" } }], cursor: 12 };
    const queue = await MutationQueue.hydrate();
    const res = await new ReconcileEngine({ transport: h.transport, queue, cursor: h.cursor, apply: h.apply }).reconcile();
    expect(res.pulled).toBe(1);
    expect(h.applied[0]).toMatchObject({ entity: "matter", row: { id: "m1" }, deleted: false });
    expect(res.cursor).toBe(12);
    expect(await h.cursor.get()).toBe(12);
  });

  it("hoppar över en pull-rad som har en ej-uppspelad lokal mutation", async () => {
    const h = harness();
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue(ev("invoice", "i1"), { mutationId: "m1" });
    // En matchande server-rad för invoice:i1 ska INTE klottra över den lokala.
    h.transport.pulls = {
      changes: [{ entity: "invoice", row: { id: "i1", v: 9 } }, { entity: "matter", row: { id: "m9" } }],
      cursor: 5,
    };
    h.transport.pushResults.set("m1", { status: "accepted", row: { id: "i1", v: 10 } });
    const res = await new ReconcileEngine({ transport: h.transport, queue, cursor: h.cursor, apply: h.apply }).reconcile();
    expect(res.pulled).toBe(1); // bara matter:m9
    expect(h.applied.some((a) => a.entity === "invoice" && (a.row as { v?: number }).v === 9)).toBe(false);
  });
});

describe("ReconcileEngine — replay", () => {
  it("accepted → applicerar kanonisk rad, ack:ar kön, räknar pushed", async () => {
    const h = harness();
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue(ev("timeEntry", "t1"), { mutationId: "m1" });
    h.transport.pushResults.set("m1", { status: "accepted", row: { id: "t1", version: 1 } });
    const res = await new ReconcileEngine({ transport: h.transport, queue, cursor: h.cursor, apply: h.apply }).reconcile();
    expect(res.pushed).toBe(1);
    expect(queue.size()).toBe(0);
    expect(h.applied.find((a) => a.entity === "timeEntry")?.row).toMatchObject({ version: 1 });
  });

  it("rebased (LWW) → applicerar serverns kanoniska rad, räknar rebased", async () => {
    const h = harness();
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue(ev("matter", "m1", { title: "lokal" }), { mutationId: "mm" });
    h.transport.pushResults.set("mm", { status: "rebased", row: { id: "m1", title: "server-vinner" } });
    const res = await new ReconcileEngine({ transport: h.transport, queue, cursor: h.cursor, apply: h.apply }).reconcile();
    expect(res.rebased).toBe(1);
    expect(res.pushed).toBe(0);
    expect(h.applied.at(-1)?.row).toMatchObject({ title: "server-vinner" });
    expect(queue.size()).toBe(0);
  });

  it("conflict (surface) → ej applicerad, ytläggs med conflictClass, ack:as ur kön", async () => {
    const h = harness();
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue({ entity: "invoice", kind: "update", row: { id: "i1", status: "SENT" } }, { mutationId: "mc" });
    h.transport.pushResults.set("mc", { status: "conflict", reason: "redan annullerad", current: { id: "i1", status: "CANCELLED" } });
    const res = await new ReconcileEngine({ transport: h.transport, queue, cursor: h.cursor, apply: h.apply }).reconcile();
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ conflictClass: "surface", reason: "redan annullerad" });
    expect(res.conflicts[0]?.current).toMatchObject({ status: "CANCELLED" });
    expect(h.applied.some((a) => a.entity === "invoice")).toBe(false); // ej applicerad
    expect(queue.size()).toBe(0); // ut ur huvudkön (konflikt-låda i resultatet)
  });

  it("blandat: accepted + conflict i FIFO, kön töms, cursor avanceras", async () => {
    const h = harness();
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue(ev("timeEntry", "t1"), { mutationId: "a" });
    await queue.enqueue({ entity: "invoice", kind: "update", row: { id: "i1" } }, { mutationId: "b" });
    h.transport.pushResults.set("b", { status: "conflict", reason: "stale" });
    h.transport.pulls = { changes: [], cursor: 99 };
    const res = await new ReconcileEngine({ transport: h.transport, queue, cursor: h.cursor, apply: h.apply }).reconcile();
    expect(h.transport.pushed).toEqual(["a", "b"]); // FIFO
    expect(res.pushed).toBe(1);
    expect(res.conflicts).toHaveLength(1);
    expect(queue.size()).toBe(0);
    expect(res.cursor).toBe(99);
  });
});
