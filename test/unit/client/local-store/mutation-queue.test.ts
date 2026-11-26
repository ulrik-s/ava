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
  QUEUE_WRITE_FAILED_MESSAGE,
} from "@/lib/client/local-store/mutation-queue";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { QUEUE_FORMAT_VERSION } from "@/lib/shared/sync/queue-format";
import { captureReportedErrors, FullableQueuePersistence } from "../../../helpers/full-queue-persistence";

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
    expect(q.pending().map((m) => ("row" in m ? (m.row as { id: string }).id : null))).toEqual(["a", "b"]);
    expect(b.enqueuedAt).toBe(2);
  });

  it("varje köpost stämplas med köformatet den skrevs i (#1247)", async () => {
    const q = new MutationQueue();
    const row = await q.enqueue(ev());
    const call = await q.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [] });
    expect(row.format).toBe(QUEUE_FORMAT_VERSION);
    expect(call.format).toBe(QUEUE_FORMAT_VERSION);
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

describe("MutationQueue — lagringen först (#1817)", () => {
  /** En kö med en lyckad post "m1", och lagringen full därefter. */
  async function fullQueue(): Promise<{ q: MutationQueue; p: FullableQueuePersistence }> {
    const p = new FullableQueuePersistence();
    const q = await MutationQueue.hydrate(p);
    await q.enqueue(ev(), { mutationId: "m1" });
    p.full = true;
    return { q, p };
  }

  it("en add som kastar ger det läsbara felet med originalfelet som cause, och rapporterar originalfelet", async () => {
    const { q } = await fullQueue();
    let thrown: unknown;
    const reported = await captureReportedErrors(async () => {
      await q.enqueue(ev(), { mutationId: "m2" }).catch((e: unknown) => { thrown = e; });
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(QUEUE_WRITE_FAILED_MESSAGE);
    expect(QUEUE_WRITE_FAILED_MESSAGE).toMatch(/kunde inte sparas i webbläsarens lagring.*Ändringen sparades inte\./);
    expect((thrown as Error).cause).toMatchObject({ name: "QuotaExceededError" });
    expect(reported).toEqual([(thrown as Error).cause]);
  });

  it("kön är oförändrad: pending, size och holds; och refresh ser inget kvitterat av en annan flik", async () => {
    const { q } = await fullQueue();
    await captureReportedErrors(() => q.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [{ entity: "timeEntry", id: "t1" }] }, { mutationId: "m2" }).catch(() => undefined));
    expect(q.pending().map((m) => m.mutationId)).toEqual(["m1"]);
    expect(q.size()).toBe(1);
    expect(q.holds("m2")).toBe(false);
    expect(q.holds("m1")).toBe(true);
    await q.refresh();
    expect(q.takeSettledElsewhere()).toEqual([]);
  });

  it("requeue med en add som kastar lämnar kön orörd", async () => {
    const { q } = await fullQueue();
    const entry = { mutationId: "r1", entity: "task", kind: "update" as const, row: { id: "i1" }, enqueuedAt: 1, format: 1 };
    await captureReportedErrors(async () => { await expect(q.requeue(entry)).rejects.toThrow(QUEUE_WRITE_FAILED_MESSAGE); });
    expect(q.pending().map((m) => m.mutationId)).toEqual(["m1"]);
  });

  it("ett originalfel som inte är ett Error rapporteras som ett Error", async () => {
    const p = new InMemoryMutationQueuePersistence();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- originalfelet ska INTE vara ett Error här
    p.add = () => Promise.reject("full");
    const q = await MutationQueue.hydrate(p);
    let thrown: unknown;
    const reported = await captureReportedErrors(async () => { await q.enqueue(ev()).catch((e: unknown) => { thrown = e; }); });
    expect((thrown as Error).cause).toBe("full");
    expect(reported).toEqual([new Error("full")]);
  });

  it("en lyckad add ger samma ordning i kön och i lagringen som förut", async () => {
    const p = new FullableQueuePersistence();
    const q = await MutationQueue.hydrate(p);
    await q.enqueue(ev(), { mutationId: "a" });
    await q.enqueueProcedure({ path: "p", input: {}, touches: [] }, { mutationId: "b" });
    await q.requeue({ mutationId: "c", entity: "task", kind: "update", row: { id: "i" }, enqueuedAt: 1, format: 1 });
    expect(q.pending().map((m) => m.mutationId)).toEqual(["a", "b", "c"]);
    expect((await p.load()).map((m) => m.mutationId)).toEqual(["a", "b", "c"]);
  });
});
