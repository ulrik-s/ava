/**
 * Köposter bär sin ägare (#1347): kön stämplar nya poster med användaren, och
 * en annan användares poster i lagringen läses aldrig in — de spelas inte upp,
 * kvitteras inte och tas inte bort (klientens vakt; servern vägrar också).
 */
import { describe, expect, it, vi } from "vitest-compat";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import {
  InMemoryMutationQueuePersistence, isOwnedBy, MutationQueue, queueEntrySchema, type QueueEntry, type QueueOwner,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import { organizationIdSchema, userIdSchema } from "@/lib/shared/schemas/ids";

const owner = (principalId: string): QueueOwner =>
  ({ principalId: userIdSchema.parse(principalId), organizationId: organizationIdSchema.parse("org-1") });
const anna = owner("u-anna");
const bo = owner("u-bo");

const row = (mutationId: string, by?: QueueOwner): QueueEntry => ({
  mutationId, entity: "contact", kind: "create", row: { id: `c-${mutationId}` }, enqueuedAt: 1, ...(by ? { owner: by } : {}),
});

describe("MutationQueue — ägare", () => {
  it("nya poster (rader och anrop) stämplas med ägaren", async () => {
    const q = new MutationQueue(new InMemoryMutationQueuePersistence(), anna);
    expect((await q.enqueue({ entity: "contact", kind: "create", row: { id: "c1" } })).owner).toEqual(anna);
    expect((await q.enqueueProcedure({ path: "timeEntry.create", input: {}, touches: [] })).owner).toEqual(anna);
  });

  it("utan ägare (demon, tester) stämplas inget", async () => {
    const q = new MutationQueue();
    expect((await q.enqueue({ entity: "contact", kind: "create", row: { id: "c1" } })).owner).toBeUndefined();
    expect((await q.enqueueProcedure({ path: "p", input: {}, touches: [] })).owner).toBeUndefined();
  });

  it("en annan användares poster läses aldrig in — och tas inte bort; poster utan ägare är databasens användares", async () => {
    const persistence = new InMemoryMutationQueuePersistence([row("a", anna), row("b", bo), row("old")]);
    const reported = vi.fn();
    const prev = globalThis.reportError;
    globalThis.reportError = reported;
    const q = await MutationQueue.hydrate(persistence, anna);
    globalThis.reportError = prev;
    expect(q.pending().map((e) => e.mutationId)).toEqual(["a", "old"]);
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/1 köade ändringar tillhör en annan användare/) }));
    await q.clear();
    expect((await persistence.load()).map((e) => e.mutationId)).toEqual(["b"]);
  });

  it("isOwnedBy", () => {
    expect(isOwnedBy(row("x"), anna)).toBe(true);
    expect(isOwnedBy(row("x", anna), anna)).toBe(true);
    expect(isOwnedBy(row("x", bo), anna)).toBe(false);
    expect(isOwnedBy(row("x", { ...anna, organizationId: organizationIdSchema.parse("org-2") }), anna)).toBe(false);
  });

  it("schemat är strikt om ägaren", () => {
    expect(queueEntrySchema.safeParse({ ...row("x"), owner: { principalId: "u", organizationId: "o", extra: 1 } }).success).toBe(false);
    expect(queueEntrySchema.safeParse(row("x", anna)).success).toBe(true);
  });
});

describe("CachingSyncDataStore — A:s kö spelas aldrig upp som B", () => {
  it("bara ägarens poster skickas till servern", async () => {
    const pushed: string[] = [];
    const transport: SyncTransport = {
      pull: async () => ({ changes: [], cursor: 0 }),
      push: async (m) => { pushed.push(m.mutationId); return { status: "accepted", row: m.row }; },
      pushProcedure: async () => ({ status: "accepted", rows: [] }),
      rows: async () => [],
    };
    const persistence = new InMemoryMutationQueuePersistence([row("annas", anna), row("bos", bo)]);
    const prev = globalThis.reportError;
    globalThis.reportError = vi.fn();
    const store = await CachingSyncDataStore.create({ transport, queuePersistence: persistence, owner: bo });
    await store.reconcile();
    globalThis.reportError = prev;
    expect(pushed).toEqual(["bos"]);
    expect((await persistence.load()).map((e) => e.mutationId)).toEqual(["annas"]);
  });
});
