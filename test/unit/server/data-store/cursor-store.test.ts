/**
 * CursorStore (ADR 0017, #414) — delta-sync-cursorns persistens.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { InMemoryCursorStore, IndexedDbCursorStore } from "@/lib/server/data-store/in-memory/cursor-store";

describe("InMemoryCursorStore", () => {
  it("default 0, set→get round-trippar", async () => {
    const c = new InMemoryCursorStore();
    expect(await c.get()).toBe(0);
    await c.set(42);
    expect(await c.get()).toBe(42);
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
