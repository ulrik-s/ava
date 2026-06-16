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
});
