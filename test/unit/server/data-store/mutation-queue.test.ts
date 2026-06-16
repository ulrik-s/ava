/**
 * MutationQueue (#413, ADR 0017) — optimistisk mutations-kö: FIFO-ordning,
 * UUIDv7-mutationId, idempotent enqueue, ack, clear, persistens (in-memory +
 * IndexedDB-rehydrering via fake-indexeddb).
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import {
  MutationQueue,
  InMemoryMutationQueuePersistence,
  IndexedDbMutationQueuePersistence,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";

const ev = (o: Partial<MutationEvent<Record<string, unknown>>> = {}): MutationEvent<Record<string, unknown>> => ({
  entity: "invoice", kind: "create", row: { id: "inv-1", amount: 100 }, ...o,
});

describe("MutationQueue — kärna", () => {
  it("enqueue genererar UUIDv7-mutationId och bevarar FIFO-ordning", async () => {
    const q = new MutationQueue();
    const a = await q.enqueue(ev({ row: { id: "a" } }), { now: 1 });
    const b = await q.enqueue(ev({ row: { id: "b" } }), { now: 2 });
    expect(a.mutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // v7
    expect(q.size()).toBe(2);
    expect(q.pending().map((m) => (m.row as { id: string }).id)).toEqual(["a", "b"]);
    expect(b.enqueuedAt).toBe(2);
  });

  it("enqueue är idempotent på explicit mutationId (re-enqueue = no-op)", async () => {
    const q = new MutationQueue();
    const first = await q.enqueue(ev(), { mutationId: "m1" });
    const again = await q.enqueue(ev({ row: { id: "annan" } }), { mutationId: "m1" });
    expect(again).toBe(first);
    expect(q.size()).toBe(1);
  });

  it("bär kind/previous/baseVersion (update)", async () => {
    const q = new MutationQueue();
    const m = await q.enqueue(
      ev({ kind: "update", row: { id: "x", v: 2 }, previous: { id: "x", v: 1 } }),
      { baseVersion: 1, mutationId: "m1" },
    );
    expect(m.kind).toBe("update");
    expect(m.previous).toEqual({ id: "x", v: 1 });
    expect(m.baseVersion).toBe(1);
  });

  it("ack tar bort en post; clear tömmer", async () => {
    const q = new MutationQueue();
    await q.enqueue(ev(), { mutationId: "m1" });
    await q.enqueue(ev(), { mutationId: "m2" });
    await q.ack("m1");
    expect(q.has("m1")).toBe(false);
    expect(q.has("m2")).toBe(true);
    await q.clear();
    expect(q.size()).toBe(0);
  });
});

describe("MutationQueue — persistens", () => {
  it("in-memory: enqueue persisteras och rehydreras", async () => {
    const p = new InMemoryMutationQueuePersistence();
    const q1 = await MutationQueue.hydrate(p);
    await q1.enqueue(ev({ row: { id: "a" } }), { mutationId: "m1" });

    const q2 = await MutationQueue.hydrate(p);
    expect(q2.size()).toBe(1);
    expect(q2.has("m1")).toBe(true);
  });

  it("ack persisteras (rehydrerad kö ser borttagningen)", async () => {
    const p = new InMemoryMutationQueuePersistence();
    const q1 = await MutationQueue.hydrate(p);
    await q1.enqueue(ev(), { mutationId: "m1" });
    await q1.enqueue(ev(), { mutationId: "m2" });
    await q1.ack("m1");

    const q2 = await MutationQueue.hydrate(p);
    expect(q2.size()).toBe(1);
    expect(q2.has("m2")).toBe(true);
  });

  it("IndexedDB-persistens rehydrerar kön över 'omstart'", async () => {
    const factory = new IDBFactory();
    const q1 = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "q-test"));
    await q1.enqueue(ev({ row: { id: "a" } }), { mutationId: "m1" });
    await q1.enqueue(ev({ row: { id: "b" } }), { mutationId: "m2" });

    const q2 = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "q-test"));
    expect(q2.size()).toBe(2);
    expect(q2.pending().map((m) => m.mutationId)).toEqual(["m1", "m2"]);
  });
});
