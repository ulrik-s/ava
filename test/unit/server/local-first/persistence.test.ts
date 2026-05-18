/**
 * Tester för `IPersistence`-implementationer.
 *
 * Vi testar:
 *   - `InMemoryPersistence` (för enhet-tester av högre lager)
 *   - `OpfsPersistence` (browser-runtime — testas mot en mockad OPFS-API
 *     i jsdom)
 *
 * Designval: en gemensam test-svit körs mot bägge backends så de
 * uppfyller Liskov-substitutionsprincipen. Skiljnaden mellan dem är
 * bara var datat hamnar.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  InMemoryPersistence,
  OpfsPersistence,
  type IPersistence,
} from "@/server/local-first/persistence";

function contractTests(name: string, factory: () => Promise<IPersistence>) {
  describe(name, () => {
    let p: IPersistence;
    beforeEach(async () => { p = await factory(); await p.clear(); });

    it("load() utan tidigare save returnerar null", async () => {
      expect(await p.load()).toBeNull();
    });

    it("save → load returnerar samma snapshot", async () => {
      await p.save({ "a.txt": "aGVq" }); // base64 "hej"
      expect(await p.load()).toEqual({ "a.txt": "aGVq" });
    });

    it("save överskriver tidigare", async () => {
      await p.save({ "a.txt": "Zm9v" });
      await p.save({ "b.txt": "YmFy" });
      expect(await p.load()).toEqual({ "b.txt": "YmFy" });
    });

    it("clear tömmer (load returnerar null igen)", async () => {
      await p.save({ "a.txt": "x" });
      await p.clear();
      expect(await p.load()).toBeNull();
    });
  });
}

contractTests("InMemoryPersistence", async () => new InMemoryPersistence());

describe("OpfsPersistence (browser-mock)", () => {
  // Mocka navigator.storage.getDirectory + FileSystemDirectoryHandle/FileHandle
  beforeEach(() => {
    const fileMap = new Map<string, string>();

    const fileHandle = (name: string) => ({
      async getFile() {
        const content = fileMap.get(name);
        if (content === undefined) throw new Error("not found");
        return {
          async text() { return content; },
        };
      },
      async createWritable() {
        return {
          async write(text: string) { fileMap.set(name, text); },
          async close() {},
        };
      },
    });

    const dirHandle = {
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        if (!fileMap.has(name) && !opts?.create) throw new Error("ENOENT");
        return fileHandle(name);
      },
      async removeEntry(name: string) {
        if (!fileMap.has(name)) throw new Error("ENOENT");
        fileMap.delete(name);
      },
    };

    vi.stubGlobal("navigator", {
      storage: { getDirectory: async () => dirHandle },
    });
    (globalThis as { __opfsMockStore?: Map<string, string> }).__opfsMockStore = fileMap;
  });

  it("är inte stödd när navigator.storage saknas", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await OpfsPersistence.isSupported()).toBe(false);
  });

  it("är stödd när navigator.storage.getDirectory finns", async () => {
    expect(await OpfsPersistence.isSupported()).toBe(true);
  });

  it("save → load round-trip via OPFS", async () => {
    const p = new OpfsPersistence("ava-demo");
    await p.save({ "matters/active/m1.json": "ewogICJpZCI6ICJtMSIKfQ==" });
    expect(await p.load()).toEqual({ "matters/active/m1.json": "ewogICJpZCI6ICJtMSIKfQ==" });
  });

  it("clear gör att load returnerar null", async () => {
    const p = new OpfsPersistence("ava-demo");
    await p.save({ "x": "y" });
    await p.clear();
    expect(await p.load()).toBeNull();
  });

  it("isolerat per key (olika instanser delar inte data)", async () => {
    const a = new OpfsPersistence("demo-a");
    const b = new OpfsPersistence("demo-b");
    await a.save({ "f": "AAAA" });
    await b.save({ "f": "BBBB" });
    expect((await a.load())!.f).toBe("AAAA");
    expect((await b.load())!.f).toBe("BBBB");
  });

  it("load returnerar null vid OPFS-fel istället för att kasta", async () => {
    const p = new OpfsPersistence("ava-demo");
    // Sabotera getDirectory så det kastar
    (globalThis as { navigator?: { storage: { getDirectory: () => unknown } } }).navigator!.storage.getDirectory = () => { throw new Error("OPFS nere"); };
    expect(await p.load()).toBeNull();
  });

  it("save sväljer fel tyst (för icke-kritisk cache)", async () => {
    const p = new OpfsPersistence("ava-demo");
    (globalThis as { navigator?: { storage: { getDirectory: () => unknown } } }).navigator!.storage.getDirectory = () => { throw new Error("OPFS nere"); };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(p.save({ "x": "y" })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
