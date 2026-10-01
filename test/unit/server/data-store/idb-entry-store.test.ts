/**
 * `IdbEntryStore` (#1346) — en rad per post i en egen databas (`<namn>-v2`),
 * FIFO-ordning, unikt id, signal till andra flikar, och flytt av den gamla
 * listan (allt under en nyckel) utan att den gamla databasen uppgraderas.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest-compat";
import { z } from "zod";
import { IdbEntryStore } from "@/lib/server/data-store/in-memory/idb-entry-store";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { LegacyList } from "@/lib/server/data-store/in-memory/legacy-list";
import { changeChannelHub } from "../../../helpers/change-channel-hub";

const item = z.object({ id: z.string(), n: z.number() });
type Item = z.infer<typeof item>;
const LEGACY = { storeName: "list", key: "items", idField: "id" };

function store<T = Item>(factory: IDBFactory, dbName: string, schema: z.ZodType<T>): IdbEntryStore<T> {
  return new IdbEntryStore({ factory, dbName, schema, legacy: LEGACY, channel: changeChannelHub()() });
}

const itemStore = (factory: IDBFactory, dbName: string): IdbEntryStore<Item> => store(factory, dbName, item);

/** En flik med gammal kod skriver hela sin lista, som förut. */
const oldTabWrites = (factory: IDBFactory, dbName: string, items: unknown): Promise<void> =>
  new IdbKv(factory, dbName, "list").put("items", items);

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

  it("delete tar bort bara den posten; ett okänt id gör ingenting; samma id kan köas igen", async () => {
    const s = itemStore(new IDBFactory(), "e-delete");
    await s.add("a", { id: "a", n: 1 });
    await s.add("b", { id: "b", n: 1 });
    await s.delete("a");
    await s.delete("finns-inte");
    expect((await s.load()).map((i) => i.id)).toEqual(["b"]);
    await s.add("a", { id: "a", n: 2 });
    expect((await s.load()).map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("en rad som inte går att tolka hoppas över och rapporteras — men ligger kvar", async () => {
    const factory = new IDBFactory();
    await store(factory, "e-bad", z.unknown()).add("trasig", { id: "trasig", n: "inte ett tal" });
    await itemStore(factory, "e-bad").add("ok", { id: "ok", n: 1 });
    const report = vi.spyOn(globalThis, "reportError").mockImplementation(() => undefined);
    expect(await itemStore(factory, "e-bad").load()).toEqual([{ id: "ok", n: 1 }]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(String(report.mock.calls[0]?.[0])).toMatch(/e-bad-v2.*kunde inte läsas/);
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

describe("IdbEntryStore — den gamla listan", () => {
  it("flyttas till raderna i samma ordning, och den gamla nyckeln tas bort", async () => {
    const factory = new IDBFactory();
    await oldTabWrites(factory, "e-legacy", [{ id: "b", n: 1 }, { id: "a", n: 2 }]);
    expect(await itemStore(factory, "e-legacy").load()).toEqual([{ id: "b", n: 1 }, { id: "a", n: 2 }]);
    expect(await legacyValue(factory, "e-legacy")).toBeUndefined();
  });

  it("den gamla databasen uppgraderas inte — en gammal flik kan fortsätta öppna den i version 1", async () => {
    const factory = new IDBFactory();
    await oldTabWrites(factory, "e-legacy-version", [{ id: "a", n: 1 }]);
    await itemStore(factory, "e-legacy-version").load();
    const db = await openExisting(factory, "e-legacy-version");
    expect(db.version).toBe(1);
    db.close();
    await expect(oldTabWrites(factory, "e-legacy-version", [{ id: "b", n: 1 }])).resolves.toBeUndefined();
  });

  it("en gammal flik som fortsätter skriva: varje post når raderna exakt en gång, i ordning", async () => {
    const factory = new IDBFactory();
    const s = itemStore(factory, "e-legacy-live");
    await oldTabWrites(factory, "e-legacy-live", [{ id: "x", n: 1 }]);
    expect((await s.load()).map((i) => i.id)).toEqual(["x"]);
    await s.add("ny", { id: "ny", n: 2 });
    await oldTabWrites(factory, "e-legacy-live", [{ id: "x", n: 1 }, { id: "y", n: 3 }]);
    expect((await s.load()).map((i) => i.id)).toEqual(["x", "ny", "y"]);
    expect((await s.load()).map((i) => i.id)).toEqual(["x", "ny", "y"]);
    expect(await legacyValue(factory, "e-legacy-live")).toBeUndefined();
  });

  it("en kvitterad post som dyker upp igen i den gamla listan köas inte om", async () => {
    const factory = new IDBFactory();
    const s = itemStore(factory, "e-legacy-acked");
    await oldTabWrites(factory, "e-legacy-acked", [{ id: "x", n: 1 }]);
    await s.load();
    await s.delete("x");
    await oldTabWrites(factory, "e-legacy-acked", [{ id: "x", n: 1 }]);
    expect(await s.load()).toEqual([]);
    expect(await legacyValue(factory, "e-legacy-acked")).toBeUndefined();
  });

  it("en post utan id får ett id ur innehållet (inget tappas, ingen dubblett); dubbletter flyttas en gång", async () => {
    const factory = new IDBFactory();
    const s = store(factory, "e-legacy-odd", z.unknown());
    await oldTabWrites(factory, "e-legacy-odd", [{ id: "a", n: 1 }, { n: 2 }, "sträng", { id: "a", n: 3 }]);
    expect(await s.load()).toEqual([{ id: "a", n: 1 }, { n: 2 }, "sträng"]);
    await oldTabWrites(factory, "e-legacy-odd", [{ n: 2 }, "sträng"]);
    expect(await s.load()).toHaveLength(3);
  });

  it("ett gammalt värde som inte är en lista lämnas orört", async () => {
    const factory = new IDBFactory();
    await oldTabWrites(factory, "e-legacy-obj", { inte: "en lista" });
    expect(await itemStore(factory, "e-legacy-obj").load()).toEqual([]);
    expect(await legacyValue(factory, "e-legacy-obj")).toEqual({ inte: "en lista" });
  });

  it("en gammal databas utan nyckeln eller utan storen ger inga poster", async () => {
    const factory = new IDBFactory();
    await oldTabWrites(factory, "e-legacy-none", []);
    await new IdbKv(factory, "e-legacy-none", "list").delete("items");
    expect(await itemStore(factory, "e-legacy-none").load()).toEqual([]);
    await new IdbKv(factory, "e-legacy-other", "annan-store").put("items", [{ id: "a", n: 1 }]);
    expect(await itemStore(factory, "e-legacy-other").load()).toEqual([]);
  });

  it("finns ingen gammal databas skapas den inte", async () => {
    const factory = new IDBFactory();
    await itemStore(factory, "e-no-legacy").add("a", { id: "a", n: 1 });
    expect(await itemStore(factory, "e-no-legacy").load()).toHaveLength(1);
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).toEqual(["e-no-legacy-v2"]);
  });

  it("blockeras inte av en gammal flik som håller den gamla databasen öppen", async () => {
    const factory = new IDBFactory();
    await oldTabWrites(factory, "e-legacy-held", [{ id: "a", n: 1 }]);
    const held = await openExisting(factory, "e-legacy-held"); // ingen onversionchange — som gammal kod
    const blocked = vi.fn();
    held.onversionchange = blocked;
    expect(await itemStore(factory, "e-legacy-held").load()).toEqual([{ id: "a", n: 1 }]);
    expect(blocked).not.toHaveBeenCalled();
    held.close();
  });
});

describe("LegacyList.clearIfMoved", () => {
  it("nyckeln ligger kvar så länge den har en post som inte flyttats (en gammal flik skrev efter läsningen)", async () => {
    const factory = new IDBFactory();
    const legacy = new LegacyList(factory, { dbName: "e-clear", ...LEGACY });
    await oldTabWrites(factory, "e-clear", [{ id: "x", n: 1 }, { id: "y", n: 2 }]);
    await legacy.clearIfMoved(new Set(["x"]));
    expect((await legacy.read()).map((r) => r.id)).toEqual(["x", "y"]);
    await legacy.clearIfMoved(new Set(["x", "y"]));
    expect(await legacy.read()).toEqual([]);
    await expect(new LegacyList(factory, { dbName: "e-clear-none", ...LEGACY }).clearIfMoved(new Set())).resolves.toBeUndefined();
  });
});

describe("IdbEntryStore — fel", () => {
  it("raddatabasen i en nyare version än koden → läsningen avvisas (inget skrivs över)", async () => {
    const factory = new IDBFactory();
    (await openAt(factory, "e-newer-v2", 9)).close();
    await expect(itemStore(factory, "e-newer").load()).rejects.toThrow();
  });

  it("en skrivning som inte går att spara avvisas", async () => {
    const s = store(new IDBFactory(), "e-unclonable", z.unknown());
    await expect(s.add("f", () => 1)).rejects.toThrow();
  });
});

/** Den gamla nyckelns värde, läst direkt ur den gamla databasen. */
async function legacyValue(factory: IDBFactory, dbName: string): Promise<unknown> {
  const db = await openExisting(factory, dbName);
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

function openExisting(factory: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openAt(factory: IDBFactory, dbName: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
