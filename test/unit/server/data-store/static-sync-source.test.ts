/**
 * `StaticSyncSource` (#543, ADR 0025) — serverlös `SyncTransport` för demon.
 * Enhetsnivå (pull/push/cursor/loopback) + integration mot `CachingSyncDataStore`
 * + `ReconcileEngine` som bevisar hela klient-reconcile-loopen.
 */

import { describe, it, expect } from "vitest-compat";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { flattenSeedToChanges, StaticSyncSource } from "@/lib/server/data-store/in-memory/static-sync-source";
import type { DemoSource } from "@/lib/shared/demo-source";

const seed: DemoSource = {
  matters: [{ id: "m1", organizationId: "org", matterNumber: "2026-1", title: "X", version: 1 }],
  contacts: [
    { id: "c1", organizationId: "org", name: "Anna", contactType: "PERSON", version: 1 },
    { id: "c2", organizationId: "org", name: "Bo", contactType: "PERSON", version: 1 },
  ],
} as unknown as DemoSource;

function mutation(over: Partial<QueuedMutation> & Pick<QueuedMutation, "entity" | "kind" | "row">): QueuedMutation {
  return { mutationId: "mut-1", enqueuedAt: 0, ...over };
}

describe("flattenSeedToChanges", () => {
  it("plattar plural-source → singular-entity-rader, hoppar okända nycklar", () => {
    const changes = flattenSeedToChanges(seed);
    expect(changes).toHaveLength(3); // 1 matter + 2 contacts
    expect(changes.filter((c) => c.entity === "matter")).toHaveLength(1);
    expect(changes.filter((c) => c.entity === "contact")).toHaveLength(2);
    // okänd source-nyckel ignoreras
    expect(flattenSeedToChanges({ totallyUnknown: [{ id: "x" }] } as unknown as DemoSource)).toEqual([]);
  });
});

describe("StaticSyncSource — pull/push/cursor", () => {
  it("pull(0) returnerar hela seeden som changes, cursor = N", async () => {
    const src = new StaticSyncSource(seed);
    const res = await src.pull(0);
    expect(res.changes).toHaveLength(3);
    expect(res.cursor).toBe(3);
  });

  it("pull(N) (allt redan hämtat) → inga changes, cursor oförändrad", async () => {
    const src = new StaticSyncSource(seed);
    const res = await src.pull(3);
    expect(res.changes).toEqual([]);
    expect(res.cursor).toBe(3);
  });

  it("tom seed → pull(0) ger inget, cursor 0", async () => {
    const res = await new StaticSyncSource().pull(0);
    expect(res.changes).toEqual([]);
    expect(res.cursor).toBe(0);
  });

  it("push ack:ar och loopback:ar raden till nästa pull (cursor monoton)", async () => {
    const src = new StaticSyncSource(seed);
    const push = await src.push(mutation({ entity: "matter", kind: "update", row: { id: "m1", title: "Y", version: 2 } }));
    expect(push).toEqual({ status: "accepted", row: { id: "m1", title: "Y", version: 2 } });
    // nästa pull sedan cursor 3 ser klientens egen ändring (seq 4)
    const res = await src.pull(3);
    expect(res.changes).toEqual([{ entity: "matter", row: { id: "m1", title: "Y", version: 2 }, deleted: false }]);
    expect(res.cursor).toBe(4);
  });

  it("delete-mutation loopback:as som tombstone (deleted)", async () => {
    const src = new StaticSyncSource(seed);
    await src.push(mutation({ entity: "contact", kind: "delete", row: { id: "c1" } }));
    const res = await src.pull(3);
    expect(res.changes).toEqual([{ entity: "contact", row: { id: "c1" }, deleted: true }]);
  });
});

describe("StaticSyncSource — integration med CachingSyncDataStore (hela reconcile-loopen)", () => {
  it("hydrerar cachen via pull, dränerar kön via loopback-push, ser egna ändringar", async () => {
    const cs = await CachingSyncDataStore.create({ transport: new StaticSyncSource(seed) });

    // Före reconcile: cachen är TOM (ingen seed-option — hydrering sker via pull).
    expect((await cs.store.matters.findMany({})).length).toBe(0);

    // reconcile #1: pull(0) → seeden appliceras (pull/apply-vägen, inte seed-option).
    const r1 = await cs.reconcile();
    expect(r1.pulled).toBe(3);
    expect((await cs.store.matters.findMany({})).length).toBe(1);
    expect((await cs.store.contacts.findMany({})).length).toBe(2);

    // Lokal mutation (offline) → köas optimistiskt.
    await cs.store.contacts.create({ data: { id: "c3", organizationId: "org", name: "Cilla", contactType: "PERSON" } as never });
    expect(cs.pendingCount()).toBe(1);
    expect((await cs.store.contacts.findMany({})).length).toBe(3);

    // reconcile #2: replay push:ar mutationen (loopback ack) → kön dräneras.
    const r2 = await cs.reconcile();
    expect(r2.pushed).toBe(1);
    expect(cs.pendingCount()).toBe(0);

    // reconcile #3: pull serverar tillbaka klientens egen push → "pull ser egna ändringen".
    const r3 = await cs.reconcile();
    expect(r3.pulled).toBe(1);
    expect((await cs.store.contacts.findMany({})).length).toBe(3); // idempotent upsert
  });
});
