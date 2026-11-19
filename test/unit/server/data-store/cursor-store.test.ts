/**
 * CursorStore (ADR 0017, #414) — delta-sync-cursorns persistens.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { InMemoryCursorStore, IndexedDbCursorStore, syncPositionSchema } from "@/lib/server/data-store/in-memory/cursor-store";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";

const EPOCH = "01a0f754-b809-7662-8de5-646987f19b9e";

describe("InMemoryCursorStore", () => {
  it("default 0, set→get round-trippar", async () => {
    const c = new InMemoryCursorStore();
    expect(await c.get()).toBe(0);
    await c.set(42);
    expect(await c.get()).toBe(42);
  });

  it("epoken (#1360): ingen från början, set→get round-trippar", async () => {
    const c = new InMemoryCursorStore();
    expect(await c.getEpoch()).toBeUndefined();
    await c.setEpoch(EPOCH);
    expect(await c.getEpoch()).toBe(EPOCH);
  });
});

describe("InMemoryCursorStore — flikens position (#1711)", () => {
  it("positionen är cursorn, och epoken när servern skickat en", async () => {
    const c = new InMemoryCursorStore(3);
    expect(c.position()).toEqual({ cursor: 3 });
    await c.setEpoch(EPOCH);
    expect(c.position()).toEqual({ cursor: 3, epoch: EPOCH });
  });

  it("restore fortsätter från en sparad position, med eller utan epok", async () => {
    const c = new InMemoryCursorStore();
    c.restore({ cursor: 7, epoch: EPOCH });
    expect(await c.get()).toBe(7);
    expect(await c.getEpoch()).toBe(EPOCH);
    c.restore({ cursor: 0 });
    expect(await c.get()).toBe(0);
    expect(await c.getEpoch()).toBeUndefined();
  });
});

describe("syncPositionSchema (#1711)", () => {
  it("godtar en cursor med eller utan epok", () => {
    expect(syncPositionSchema.safeParse({ cursor: 0 }).success).toBe(true);
    expect(syncPositionSchema.safeParse({ cursor: 4, epoch: EPOCH }).success).toBe(true);
  });

  it("avvisar en trasig post", () => {
    for (const bad of [null, 4, { cursor: -1 }, { cursor: 1.5 }, { cursor: 1, epoch: "inte-ett-uuid" }, { cursor: 1, extra: true }]) {
      expect(syncPositionSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("IndexedDbCursorStore", () => {
  it("tom DB → 0", async () => {
    const c = new IndexedDbCursorStore(new IDBFactory(), "cursor-empty");
    expect(await c.get()).toBe(0);
  });

  it("set persisteras över 'omstart'", async () => {
    const factory = new IDBFactory();
    await new IndexedDbCursorStore(factory, "cursor-rt").set(7);
    expect(await new IndexedDbCursorStore(factory, "cursor-rt").get()).toBe(7);
  });
});

describe("IndexedDbCursorStore — epoken (#1360)", () => {
  it("ingen sparad → undefined; sparad persisteras över 'omstart'", async () => {
    const factory = new IDBFactory();
    expect(await new IndexedDbCursorStore(factory, "epoch-rt").getEpoch()).toBeUndefined();
    await new IndexedDbCursorStore(factory, "epoch-rt").setEpoch(EPOCH);
    expect(await new IndexedDbCursorStore(factory, "epoch-rt").getEpoch()).toBe(EPOCH);
  });

  it("en sparad epok som inte är ett uuid räknas som ingen", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "epoch-bad", "cursor").put("epoch", 42);
    expect(await new IndexedDbCursorStore(factory, "epoch-bad").getEpoch()).toBeUndefined();
  });
});
