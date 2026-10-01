/**
 * `copyDatabase` (#1347): en databas kopieras till en annan — idempotent (målet
 * vinner), med sammanslagning när anroparen vill, och utan att källan
 * uppgraderas eller målet skapas när källan saknas. Plus `deleteDatabase` och
 * `IdbKv.keys`, som rensningen bygger på.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { copyDatabase } from "@/lib/server/data-store/in-memory/idb-copy";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import { deleteDatabase, openDatabase } from "@/lib/server/data-store/in-memory/idb-open";

const names = async (f: IDBFactory): Promise<string[]> => (await f.databases()).map((d) => d.name ?? "").sort();

describe("copyDatabase", () => {
  it("kopierar alla nycklar; finns källan inte skapas inget mål", async () => {
    const f = new IDBFactory();
    expect(await copyDatabase(f, "saknas", "mål")).toBe(false);
    expect(await names(f)).toEqual([]);

    await new IdbKv(f, "källa", "kv").put("a", 1);
    await new IdbKv(f, "källa", "kv").put("b", { x: 2 });
    expect(await copyDatabase(f, "källa", "mål")).toBe(true);
    expect(await new IdbKv(f, "mål", "kv").get("a")).toBe(1);
    expect(await new IdbKv(f, "mål", "kv").get("b")).toEqual({ x: 2 });
  });

  it("målet vinner (det är nyare) — utom när merge slår ihop", async () => {
    const f = new IDBFactory();
    await new IdbKv(f, "källa", "kv").put("k", "gammal");
    await new IdbKv(f, "källa", "kv").put("m", [1]);
    await new IdbKv(f, "mål", "kv").put("k", "ny");
    await new IdbKv(f, "mål", "kv").put("m", [2]);
    await copyDatabase(f, "källa", "mål", (_s, key, existing, incoming) =>
      (key === "m" ? [...(existing as number[]), ...(incoming as number[])] : undefined));
    expect(await new IdbKv(f, "mål", "kv").get("k")).toBe("ny");
    expect(await new IdbKv(f, "mål", "kv").get("m")).toEqual([2, 1]);
  });

  it("stores med keyPath kopieras med sin form", async () => {
    const f = new IDBFactory();
    const src = await openDatabase({ factory: f, name: "blobbar", version: 1, upgrade: (db) => db.createObjectStore("blobs", { keyPath: "id" }) });
    await new Promise<void>((resolve) => {
      const tx = src.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put({ id: "d1", bytes: new Uint8Array([1]) });
      tx.oncomplete = () => resolve();
    });
    src.close();
    await copyDatabase(f, "blobbar", "blobbar@scope");
    const dst = await openDatabase({ factory: f, name: "blobbar@scope", version: 1, upgrade: () => undefined });
    const row = await new Promise<unknown>((resolve) => {
      const req = dst.transaction("blobs", "readonly").objectStore("blobs").get("d1");
      req.onsuccess = () => resolve(req.result);
    });
    dst.close();
    expect(row).toEqual({ id: "d1", bytes: new Uint8Array([1]) });
  });

  it("en källa utan stores kopieras inte (inget mål); ett mål som saknar storen hoppas över", async () => {
    const f = new IDBFactory();
    (await openDatabase({ factory: f, name: "tom", version: 1, upgrade: () => undefined })).close();
    expect(await copyDatabase(f, "tom", "mål-tom")).toBe(true);
    expect(await names(f)).toEqual(["tom"]);

    await new IdbKv(f, "källa2", "a").put("k", 1);
    await new IdbKv(f, "mål2", "b").put("k", 2);
    await copyDatabase(f, "källa2", "mål2");
    expect(await new IdbKv(f, "mål2", "b").get("k")).toBe(2);
  });
});

describe("deleteDatabase / IdbKv.keys", () => {
  it("raderar; blockerad → false efter tidsgränsen", async () => {
    const f = new IDBFactory();
    await new IdbKv(f, "x", "kv").put("k", 1);
    expect(await new IdbKv(f, "x", "kv").keys()).toEqual(["k"]);
    expect(await deleteDatabase(f, "x")).toBe(true);
    expect(await names(f)).toEqual([]);

    await new IdbKv(f, "y", "kv").put("k", 1);
    const held = await new Promise<IDBDatabase>((resolve) => {
      const req = f.open("y");
      req.onsuccess = () => resolve(req.result);
    });
    expect(await deleteDatabase(f, "y", 20)).toBe(false);
    held.close();
  });

  it("ett fel → false", async () => {
    class Failing extends IDBFactory {
      override deleteDatabase(name: string): IDBOpenDBRequest {
        const req = super.deleteDatabase(name);
        queueMicrotask(() => req.onerror?.(new Event("error")));
        return req;
      }
    }
    expect(await deleteDatabase(new Failing(), "z", 50)).toBe(false);
  });
});
