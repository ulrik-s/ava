/**
 * `MutationQueue` med procedur-anrop (#1265, ADR 0037).
 *
 * Kön bär nu två sorters poster: färdiga rader (radkön, de entiteter som inte
 * flyttats än) och procedur-anrop `{ mutationId, path, input, codeVersion,
 * touches }`. Äldre persisterade poster saknar `type` och är rader.
 */
import { describe, expect, it } from "vitest-compat";
import {
  InMemoryMutationQueuePersistence,
  isProcedureCall,
  MutationQueue,
  type QueuedMutation,
} from "@/lib/server/data-store/in-memory/mutation-queue";

const call = { path: "timeEntry.create", input: { id: "t1" }, touches: [{ entity: "timeEntry", id: "t1" }] };

describe("MutationQueue — procedur-anrop", () => {
  it("köar ett anrop med mutationId, codeVersion och tidsstämpel; räknas i size()", async () => {
    const persistence = new InMemoryMutationQueuePersistence();
    const q = await MutationQueue.hydrate(persistence);
    const item = await q.enqueueProcedure(call, { now: 1000, codeVersion: "abc" });
    expect(item).toMatchObject({ type: "procedure", path: "timeEntry.create", codeVersion: "abc", enqueuedAt: 1000 });
    expect(typeof item.mutationId).toBe("string");
    expect(q.size()).toBe(1);
    expect(await persistence.load()).toHaveLength(1);
  });

  it("idempotent på mutationId", async () => {
    const q = await MutationQueue.hydrate();
    await q.enqueueProcedure(call, { mutationId: "m1" });
    await q.enqueueProcedure(call, { mutationId: "m1" });
    expect(q.size()).toBe(1);
  });

  it("bevarar FIFO mellan rader och anrop, och ack tar bort rätt post", async () => {
    const q = await MutationQueue.hydrate();
    await q.enqueue({ entity: "contact", kind: "create", row: { id: "c1" } }, { mutationId: "r1" });
    await q.enqueueProcedure(call, { mutationId: "p1" });
    expect(q.pending().map((e) => e.mutationId)).toEqual(["r1", "p1"]);
    await q.ack("r1");
    expect(q.pending().map((e) => e.mutationId)).toEqual(["p1"]);
  });

  it("isProcedureCall skiljer posterna åt; en gammal post utan type är en rad", async () => {
    const legacy: QueuedMutation = { mutationId: "old", entity: "matter", kind: "update", row: { id: "m" }, enqueuedAt: 0 };
    const q = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence([legacy]));
    await q.enqueueProcedure(call, { mutationId: "p" });
    const [a, b] = q.pending();
    expect(isProcedureCall(a!)).toBe(false);
    expect(isProcedureCall(b!)).toBe(true);
  });

  it("default codeVersion är satt (aldrig tom)", async () => {
    const q = await MutationQueue.hydrate();
    const item = await q.enqueueProcedure(call);
    expect(item.codeVersion.length).toBeGreaterThan(0);
  });
});
