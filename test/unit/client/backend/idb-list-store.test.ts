/**
 * `IndexedDbListStore` (#1243) — listan överlever en ny instans (omladdning),
 * och olika databaser delar inte data.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { IndexedDbListStore } from "@/lib/client/backend/idb-list-store";

describe("IndexedDbListStore", () => {
  it("tom från början", async () => {
    expect(await new IndexedDbListStore<number>("tom", new IDBFactory()).load()).toEqual([]);
  });

  it("det som sparas läses tillbaka av en NY instans (överlever omladdning)", async () => {
    const factory = new IDBFactory();
    await new IndexedDbListStore<{ id: string }>("kö", factory).save([{ id: "a" }, { id: "b" }]);
    expect(await new IndexedDbListStore<{ id: string }>("kö", factory).load()).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("en sparning ersätter hela listan", async () => {
    const store = new IndexedDbListStore<number>("ersätt", new IDBFactory());
    await store.save([1, 2, 3]);
    await store.save([4]);
    expect(await store.load()).toEqual([4]);
  });

  it("olika databaser är separata", async () => {
    const factory = new IDBFactory();
    await new IndexedDbListStore<number>("en", factory).save([1]);
    expect(await new IndexedDbListStore<number>("två", factory).load()).toEqual([]);
  });
});
