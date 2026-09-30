/**
 * Dokumenttext på enheten (#1244): sparas i IndexedDB och finns kvar till nästa start.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest-compat";
import { LocalDocumentTextStore } from "@/lib/client/backend/local-document-text";

let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); });

describe("LocalDocumentTextStore", () => {
  it("tom från början", async () => {
    const store = new LocalDocumentTextStore(factory);
    expect(await store.has("d1")).toBe(false);
    expect(await store.loadAll()).toEqual([]);
  });

  it("sparad text finns kvar för en ny instans (efter omladdning)", async () => {
    await new LocalDocumentTextStore(factory).put("d1", "stämningsansökan");
    const again = new LocalDocumentTextStore(factory);
    expect(await again.has("d1")).toBe(true);
    expect(await again.loadAll()).toEqual([["d1", "stämningsansökan"]]);
  });

  it("samma dokument två gånger: senaste texten, en rad i indexet", async () => {
    const store = new LocalDocumentTextStore(factory);
    await store.put("d1", "v1");
    await store.put("d1", "v2");
    await store.put("d2", "annat");
    expect(await store.loadAll()).toEqual([["d1", "v2"], ["d2", "annat"]]);
  });
});
