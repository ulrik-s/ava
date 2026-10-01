/**
 * `IdbEntryStore` (#1346) — en rad per post i IndexedDB, FIFO-ordning, unikt
 * id, signal till andra flikar och uppgradering från listan under en nyckel.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest-compat";
import { z } from "zod";
import { IdbEntryStore } from "@/lib/server/data-store/in-memory/idb-entry-store";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { changeChannelHub } from "../../../helpers/change-channel-hub";

const item = z.object({ id: z.string(), n: z.number() });
type Item = z.infer<typeof item>;
const LEGACY = { storeName: "list", key: "items", idField: "id" };

function store<T = Item>(factory: IDBFactory, dbName: string, schema: z.ZodType<T>): IdbEntryStore<T> {
  return new IdbEntryStore({ factory, dbName, schema, legacy: LEGACY, channel: changeChannelHub()() });
}

const itemStore = (factory: IDBFactory, dbName: string): IdbEntryStore<Item> => store(factory, dbName, item);

describe("IdbEntryStore — poster", () => {
  it("en tom databas ger en tom lista", async () => {
    expect(await itemStore(new IDBFactory(), "e-empty").load()).toEqual([]);
  });

  it("poster läses i den ordning de lades till, oavsett id", async () => {
    const s = itemStore(new IDBFactory(), "e-order");
    await s.add("c", { id: "c", n: 1 });
    await s.add("a", { id: "a", n: 2 });
    await s.add("b", { id: "b", n: 3 });
    expect((await s.load()).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("add med ett id som redan finns gör ingenting", async () => {
    const s = itemStore(new IDBFactory(), "e-dupe");
    await s.add("a", { id: "a", n: 1 });
    await s.add("a", { id: "a", n: 2 });
    expect(await s.load()).toEqual([{ id: "a", n: 1 }]);
  });

  it("put ersätter posten på sin plats, eller lägger den sist", async () => {
    const s = itemStore(new IDBFactory(), "e-put");
    await s.add("a", { id: "a", n: 1 });
    await s.add("b", { id: "b", n: 1 });
    await s.put("a", { id: "a", n: 9 });
    await s.put("c", { id: "c", n: 1 });
    expect(await s.load()).toEqual([{ id: "a", n: 9 }, { id: "b", n: 1 }, { id: "c", n: 1 }]);
  });

  it("delete tar bort bara den posten; ett okänt id gör ingenting", async () => {
    const s = itemStore(new IDBFactory(), "e-delete");
    await s.add("a", { id: "a", n: 1 });
    await s.add("b", { id: "b", n: 1 });
    await s.delete("a");
    await s.delete("finns-inte");
    expect((await s.load()).map((i) => i.id)).toEqual(["b"]);
  });

  it("en rad som inte går att tolka hoppas över och rapporteras — men ligger kvar", async () => {
    const factory = new IDBFactory();
    await store(factory, "e-bad", z.unknown()).add("trasig", { id: "trasig", n: "inte ett tal" });
    await itemStore(factory, "e-bad").add("ok", { id: "ok", n: 1 });
    const report = vi.spyOn(globalThis, "reportError").mockImplementation(() => undefined);
    expect(await itemStore(factory, "e-bad").load()).toEqual([{ id: "ok", n: 1 }]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0]?.[0])).toMatch(/e-bad.*kunde inte läsas/);
    report.mockRestore();
    expect(await store(factory, "e-bad", z.unknown()).load()).toHaveLength(2);
  });

  it("utan reportError hoppas raden ändå över", async () => {
    const factory = new IDBFactory();
    await store(factory, "e-bad-quiet", z.unknown()).add("trasig", { id: "trasig" });
    const original = globalThis.reportError;
    // @ts-expect-error -- simulerar en miljö utan reportError
    globalThis.reportError = undefined;
    try {
      expect(await itemStore(factory, "e-bad-quiet").load()).toEqual([]);
    } finally {
      globalThis.reportError = original;
    }
  });
});

describe("IdbEntryStore — andra flikar", () => {
  it("varje skrivning når de andra flikarnas lyssnare, inte den egna", async () => {
    const factory = new IDBFactory();
    const hub = changeChannelHub();
    const a = new IdbEntryStore({ factory, dbName: "e-signal", schema: item, legacy: LEGACY, channel: hub() });
    const b = new IdbEntryStore({ factory, dbName: "e-signal", schema: item, legacy: LEGACY, channel: hub() });
    const heard: string[] = [];
    a.subscribe(() => heard.push("a"));
    b.subscribe(() => heard.push("b"));
    await a.add("x", { id: "x", n: 1 });
    await a.put("x", { id: "x", n: 2 });
    await a.delete("x");
    expect(heard).toEqual(["b", "b", "b"]);
  });

  it("utan injicerad kanal används en BroadcastChannel per databas", async () => {
    const s = new IdbEntryStore({ factory: new IDBFactory(), dbName: "e-default", schema: item, legacy: LEGACY });
    const off = s.subscribe(() => undefined);
    await s.add("x", { id: "x", n: 1 });
    off();
    expect(await s.load()).toEqual([{ id: "x", n: 1 }]);
  });
});

describe("IdbEntryStore — uppgradering från listan under en nyckel", () => {
  it("listan flyttas till rader i samma ordning, och den gamla nyckeln tas bort", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "e-legacy", "list").put("items", [{ id: "b", n: 1 }, { id: "a", n: 2 }]);
    expect(await itemStore(factory, "e-legacy").load()).toEqual([{ id: "b", n: 1 }, { id: "a", n: 2 }]);
    expect(await legacyValue(factory, "e-legacy")).toBeUndefined();
  });

  it("en post utan id får ett eget id (inget tappas); dubbletter flyttas en gång", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "e-legacy-odd", "list").put("items", [{ id: "a", n: 1 }, { n: 2 }, "sträng", { id: "a", n: 3 }]);
    const rows = await store(factory, "e-legacy-odd", z.unknown()).load();
    expect(rows).toEqual([{ id: "a", n: 1 }, { n: 2 }, "sträng"]);
  });

  it("ett gammalt värde som inte är en lista lämnas orört", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "e-legacy-obj", "list").put("items", { inte: "en lista" });
    expect(await itemStore(factory, "e-legacy-obj").load()).toEqual([]);
    expect(await legacyValue(factory, "e-legacy-obj")).toEqual({ inte: "en lista" });
  });

  it("en databas utan den gamla nyckeln uppgraderas till tomma rader", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "e-legacy-none", "list").put("annat", 1);
    expect(await itemStore(factory, "e-legacy-none").load()).toEqual([]);
  });
});

describe("IdbEntryStore — fel", () => {
  it("en databas i en nyare version än koden → läsningen avvisas (inget skrivs över)", async () => {
    const factory = new IDBFactory();
    await openAt(factory, "e-newer", 9);
    await expect(itemStore(factory, "e-newer").load()).rejects.toThrow();
  });

  it("en skrivning som inte går att spara avvisas", async () => {
    const s = store(new IDBFactory(), "e-unclonable", z.unknown());
    await expect(s.add("f", () => 1)).rejects.toThrow();
  });
});

/** Den gamla nyckelns värde, läst direkt ur databasen (version 2). */
async function legacyValue(factory: IDBFactory, dbName: string): Promise<unknown> {
  const db = await openAt(factory, dbName, 2);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction("list", "readonly").objectStore("list").get("items");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

function openAt(factory: IDBFactory, dbName: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
