/**
 * Avvisade ändringar med flera flikar (#1346) — varje flik har sin egen lista
 * över samma IndexedDB. Ingen flik får skriva över en annan fliks avvisningar.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import {
  IndexedDbRejectedChangesPersistence, InMemoryRejectedChangesPersistence, RejectedChanges, type RejectedChange,
} from "@/lib/client/backend/rejected-changes";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { ConflictRecord } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { changeChannelHub, settle } from "../../../helpers/change-channel-hub";

const conflict = (mutationId: string): ConflictRecord => {
  const mutation: QueuedMutation = { mutationId, entity: "invoice", kind: "update", row: { id: "i1" }, enqueuedAt: 0 };
  return { mutation, conflictClass: "surface", reason: "stale" };
};

async function tab(factory: IDBFactory, dbName: string): Promise<RejectedChanges> {
  const changes = new RejectedChanges();
  await changes.attach(new IndexedDbRejectedChangesPersistence(factory, dbName));
  return changes;
}

describe("RejectedChanges — flera flikar (#1346)", () => {
  it("flik A sparar r1, flik B sparar r2 utan att känna till r1 → båda finns kvar", async () => {
    const factory = new IDBFactory();
    const a = await tab(factory, "rej-tabs");
    const b = await tab(factory, "rej-tabs");
    await a.record([conflict("r1")], 1);
    await b.record([conflict("r2")], 2);
    expect((await tab(factory, "rej-tabs")).list().map((c) => c.id)).toEqual(["r1", "r2"]);
  });

  it("en flik som kastar en ändring tar inte bort en annan fliks nya avvisning", async () => {
    const factory = new IDBFactory();
    const a = await tab(factory, "rej-discard");
    await a.record([conflict("r1")], 1);
    const b = await tab(factory, "rej-discard");
    await a.record([conflict("r2")], 2);
    await b.discard("r1");
    expect((await tab(factory, "rej-discard")).list().map((c) => c.id)).toEqual(["r2"]);
  });
});

describe("RejectedChanges — signal från andra flikar (#1346)", () => {
  it("en annan fliks avvisning läses in och lyssnarna får den nya listan", async () => {
    const factory = new IDBFactory();
    const hub = changeChannelHub();
    const a = new RejectedChanges();
    await a.attach(new IndexedDbRejectedChangesPersistence(factory, "rej-signal", hub()));
    const b = new RejectedChanges();
    await b.attach(new IndexedDbRejectedChangesPersistence(factory, "rej-signal", hub()));
    const seen: number[] = [];
    b.subscribe((items) => seen.push(items.length));
    await a.record([conflict("r1")], 1);
    await settle();
    expect(seen).toEqual([1]);
    expect(b.list().map((c) => c.id)).toEqual(["r1"]);
  });

  it("byte av lagring släpper den förra lagringens signal", async () => {
    const factory = new IDBFactory();
    const hub = changeChannelHub();
    const other = new RejectedChanges();
    await other.attach(new IndexedDbRejectedChangesPersistence(factory, "rej-detach", hub()));
    const b = new RejectedChanges();
    await b.attach(new IndexedDbRejectedChangesPersistence(factory, "rej-detach", hub()));
    await b.attach(new InMemoryRejectedChangesPersistence());
    await other.record([conflict("r1")], 1);
    await settle();
    expect(b.list()).toEqual([]);
  });
});

describe("RejectedChanges — uppgradering från listan under en nyckel (#1346)", () => {
  it("avvisningar sparade av förra releasen läses in post för post — ingen tappas", async () => {
    const factory = new IDBFactory();
    const saved: RejectedChange[] = [
      { id: "r1", rejectedAt: 1, label: "Ändring av faktura", reason: "stale", entry: conflict("r1").mutation, current: { id: "i1" } },
      { id: "r2", rejectedAt: 2, label: "Ändring av faktura", reason: "låst", entry: conflict("r2").mutation },
    ];
    await new IdbKv(factory, "rej-upgrade", "rejected").put("items", saved);
    const changes = await tab(factory, "rej-upgrade");
    expect(changes.list()).toEqual(saved);
    await changes.discard("r1");
    expect((await tab(factory, "rej-upgrade")).list().map((c) => c.id)).toEqual(["r2"]);
  });
});
