/**
 * IdbKv (#413) — generisk IndexedDB key-value, testad mot fake-indexeddb.
 * Round-trip, miss → null, överskrivning, och isolering mellan stores.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";

describe("IdbKv", () => {
  it("get på saknad nyckel → null", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-empty", "s");
    expect(await kv.get("nope")).toBeNull();
  });

  it("put → get round-trippar och bevarar Date", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-roundtrip", "s");
    const d = new Date("2026-06-16T08:00:00.000Z");
    await kv.put("k", { n: 1, when: d });
    const out = await kv.get<{ n: number; when: Date }>("k");
    expect(out?.n).toBe(1);
    expect(out?.when).toBeInstanceOf(Date);
    expect(out?.when.getTime()).toBe(d.getTime());
  });

  it("put skriver över föregående värde", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-overwrite", "s");
    await kv.put("k", "a");
    await kv.put("k", "b");
    expect(await kv.get("k")).toBe("b");
  });

  it("olika nycklar är isolerade", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-keys", "s");
    await kv.put("a", 1);
    await kv.put("b", 2);
    expect(await kv.get("a")).toBe(1);
    expect(await kv.get("b")).toBe(2);
  });

  it("getAll läser flera nycklar i ordning; en saknad nyckel → null (#1711)", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-get-all", "s");
    await kv.putAll([["a", 1], ["c", { n: 3 }]]);
    expect(await kv.getAll(["c", "b", "a"])).toEqual([{ n: 3 }, null, 1]);
    expect(await kv.getAll([])).toEqual([]);
  });
});

describe("IdbKv.update — läs och skriv i en transaktion (#1714)", () => {
  it("steget får de lagrade värdena (null för en saknad nyckel) och skriver sitt svar", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-update", "s");
    await kv.put("a", 1);
    let seen: unknown[] = [];
    await kv.update(["a", "b"], (stored) => {
      seen = stored;
      return [["b", 2], ["c", 3]];
    });
    expect(seen).toEqual([1, null]);
    expect(await kv.getAll(["a", "b", "c"])).toEqual([1, 2, 3]);
  });

  it("ett steg kan läsa mer i samma transaktion innan det skriver", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-update-chain", "s");
    await kv.putAll([["pekare", "stor"], ["stor", { n: 7 }]]);
    await kv.update(["pekare"], ([key]) => ({
      keys: [String(key)],
      next: ([value]) => [["kopia", value]],
    }));
    expect(await kv.get("kopia")).toEqual({ n: 7 });
  });

  it("utan nycklar körs steget direkt, med en tom lista", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-update-empty", "s");
    await kv.update([], (stored) => [["antal", stored.length]]);
    expect(await kv.get("antal")).toBe(0);
  });

  it("ett steg som inte skriver något lämnar lagringen orörd", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-update-noop", "s");
    await kv.put("a", 1);
    await kv.update(["a"], () => []);
    expect(await kv.get("a")).toBe(1);
  });

  it("kastar steget avbryts transaktionen: inget skrivs och felet kastas vidare", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-update-throw", "s");
    await kv.put("a", 1);
    await expect(kv.update(["a"], () => { throw new Error("nej"); })).rejects.toThrow("nej");
    // Också i ett senare steg, efter att det första redan läst.
    await expect(kv.update(["a"], () => ({ keys: ["a"], next: () => { throw new Error("senare"); } }))).rejects.toThrow("senare");
    expect(await kv.get("a")).toBe(1);
  });

  it("putAll med vakt: vakten får det lagrade värdet och kan vägra", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-guard", "s");
    await kv.put("format", 2);
    let seen: unknown = undefined;
    await kv.putAll([["a", 1]], { key: "format", check: (stored) => { seen = stored; } });
    expect(seen).toBe(2);
    await expect(kv.putAll([["a", 9]], { key: "format", check: () => { throw new Error("för nytt"); } })).rejects.toThrow("för nytt");
    expect(await kv.get("a")).toBe(1);
  });
});

describe("IdbKv — nycklar, borttagning och fel vid öppning (#1905)", () => {
  it("keys listar de lagrade nycklarna", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-keys-list", "s");
    expect(await kv.keys()).toEqual([]);
    await kv.putAll([["b", 2], ["a", 1]]);
    expect((await kv.keys()).sort()).toEqual(["a", "b"]);
  });

  it("delete tar bort nyckeln, och en saknad nyckel går bra", async () => {
    const kv = new IdbKv(new IDBFactory(), "kv-delete", "s");
    await kv.putAll([["a", 1], ["b", 2]]);
    await kv.delete("a");
    await kv.delete("saknas");
    expect(await kv.getAll(["a", "b"])).toEqual([null, 2]);
  });

  it("en databas i en nyare version går inte att öppna: felet kastas vidare", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open("kv-newer", 2);
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error ?? new Error("open"));
    });
    const kv = new IdbKv(factory, "kv-newer", "s");
    await expect(kv.get("a")).rejects.toMatchObject({ name: "VersionError" });
  });
});
