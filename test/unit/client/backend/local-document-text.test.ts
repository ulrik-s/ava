/**
 * Dokumenttext på enheten (#1244): sparas i IndexedDB och finns kvar till nästa start;
 * hålls under en budget (LRU) och glömmer borttagna dokument (#1347).
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest-compat";
import {
  DOC_TEXT_BUDGET_BYTES, LocalDocumentTextStore, overBudget, textBytes,
} from "@/lib/client/backend/local-document-text";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";

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

describe("LocalDocumentTextStore — budget och borttagna dokument (#1347)", () => {
  /** Klocka som tickar en ms per anrop — ordningen avgör vad som är äldst. */
  function ticking(): () => number {
    let t = 1000;
    return () => t++;
  }

  it("över budgeten går den text som använts längst sedan först (LRU)", async () => {
    // Budget 20 byte; varje text är 4 tecken = 8 byte → två får plats.
    const store = new LocalDocumentTextStore(factory, { budgetBytes: 20, now: ticking() });
    await store.put("d1", "aaaa");
    await store.put("d2", "bbbb");
    await store.put("d3", "cccc");
    expect((await store.loadAll()).map(([id]) => id)).toEqual(["d2", "d3"]);
    expect(await store.has("d1")).toBe(false);
  });

  it("reconcile: använda dokument räknas som nya, borttagna glöms", async () => {
    const store = new LocalDocumentTextStore(factory, { budgetBytes: 20, now: ticking() });
    await store.put("d1", "aaaa");
    await store.put("d2", "bbbb");
    // d1 används (aktivt ärende) → nyast; d2 finns kvar men används inte.
    await store.reconcile(new Set(["d1", "d2"]), new Set(["d1"]));
    await store.put("d3", "cccc");
    expect((await store.loadAll()).map(([id]) => id).sort()).toEqual(["d1", "d3"]);
    // d3 togs bort → dess text glöms vid nästa reconcile.
    await store.reconcile(new Set(["d1"]), new Set());
    expect((await store.loadAll()).map(([id]) => id)).toEqual(["d1"]);
  });

  it("en text större än hela budgeten sparas inte", async () => {
    const store = new LocalDocumentTextStore(factory, { budgetBytes: 4 });
    await store.put("d1", "för lång text");
    expect(await store.has("d1")).toBe(false);
  });

  it("text som inget index pekar på (en annan flik skrev indexet) tas bort vid reconcile", async () => {
    const dbName = "text-orphans";
    const store = new LocalDocumentTextStore(factory, { dbName });
    await store.put("d1", "ett");
    // En annan flik skriver ett index utan d1 (sista skrivningen vinner).
    await new IdbKv(factory, dbName, "kv").put("__index__", []);
    await new IdbKv(factory, dbName, "kv").put("text:d2", "ingen pekar hit");
    await store.reconcile(new Set(["d1", "d2"]), new Set());
    expect(await new IdbKv(factory, dbName, "kv").keys()).toEqual(["__index__"]);
  });

  it("ett index från före #1347 (bara id:n) läses, med storleken ur texten", async () => {
    const dbName = "text-legacy";
    const kv = new IdbKv(factory, dbName, "kv");
    await kv.put("text:d1", "gammal");
    await kv.put("text:d9", "");
    await kv.put("__index__", ["d1", "d9"]);
    const store = new LocalDocumentTextStore(factory, { dbName, budgetBytes: 12 });
    expect(await store.loadAll()).toEqual([["d1", "gammal"]]);
    // 6 tecken = 12 byte fyller budgeten, så en ny text tränger ut den gamla.
    await store.put("d2", "ny");
    expect((await store.loadAll()).map(([id]) => id)).toEqual(["d2"]);
  });

  it("ett trasigt index ger en tom cache, inget fel", async () => {
    const dbName = "text-broken";
    await new IdbKv(factory, dbName, "kv").put("__index__", { inte: "en lista" });
    expect(await new LocalDocumentTextStore(factory, { dbName }).loadAll()).toEqual([]);
  });

  it("overBudget: nyast först; det som inte ryms returneras", () => {
    const entries = [{ id: "a", bytes: 5, usedAt: 1 }, { id: "b", bytes: 5, usedAt: 3 }, { id: "c", bytes: 5, usedAt: 2 }];
    expect(overBudget(entries, 10).map((e) => e.id)).toEqual(["a"]);
    expect(overBudget(entries, 15)).toEqual([]);
  });

  it("textBytes räknar UTF-16 (två byte per tecken)", () => {
    expect(textBytes("åäö")).toBe(6);
  });

  it("standardbudgeten är 50 MB", () => {
    expect(DOC_TEXT_BUDGET_BYTES).toBe(50 * 1024 * 1024);
  });
});
