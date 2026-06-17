/**
 * `IndexedDbFsPersistence` (#3) — DemoRuntime-slab-snapshot i IndexedDB (demo-
 * cachen). Testas mot fake-indexeddb (happy-dom saknar IndexedDB). load/save/
 * clear-round-trip + zod-validering vid parsegränsen.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect } from "vitest-compat";
import { IndexedDbFsPersistence } from "@/lib/server/local-first/indexeddb-fs-persistence";

describe("IndexedDbFsPersistence", () => {
  it("load på tom DB → null", async () => {
    const p = new IndexedDbFsPersistence("ava-fs-empty", new IDBFactory());
    expect(await p.load()).toBeNull();
  });

  it("save → load round-trippar slab-snapshotten (path → base64)", async () => {
    const p = new IndexedDbFsPersistence("ava-fs-roundtrip", new IDBFactory());
    const snap = { "matters/m1.json": "eyJpZCI6Im0xIn0=", "documents/content/d1.pdf": "JVBERi0=" };
    await p.save(snap);
    expect(await p.load()).toEqual(snap);
  });

  it("save skriver över; clear nollställer → load null", async () => {
    const p = new IndexedDbFsPersistence("ava-fs-clear", new IDBFactory());
    await p.save({ "a.json": "x" });
    await p.save({ "b.json": "y" });
    expect(await p.load()).toEqual({ "b.json": "y" });
    await p.clear();
    expect(await p.load()).toBeNull();
  });

  it("ogiltig snapshot-form (zod) → null (tolerant cache-fallback)", async () => {
    const factory = new IDBFactory();
    const p = new IndexedDbFsPersistence("ava-fs-bad", factory);
    // Skriv en icke-Record<string,string> direkt via en andra instans/raw put.
    await p.save({ ok: "1" });
    // Sabotera: en ny instans som lagrar fel form under samma nyckel.
    const bad = new IndexedDbFsPersistence("ava-fs-bad", factory);
    // @ts-expect-error — medvetet fel form för parse-gränstest
    await bad.save({ n: 123 });
    expect(await p.load()).toBeNull();
  });

  it("tom key → kastar", () => {
    expect(() => new IndexedDbFsPersistence("", new IDBFactory())).toThrow();
  });
});
