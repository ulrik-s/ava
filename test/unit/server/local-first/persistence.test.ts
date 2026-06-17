/**
 * Tester för `IPersistence`-implementationer.
 *
 * `InMemoryPersistence` (tester/fallback). `OpfsPersistence` togs bort i #420
 * (demon kör på IndexedDB sedan #483 — se `indexeddb-fs-persistence.test.ts`).
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { InMemoryPersistence, type IPersistence } from "@/lib/server/local-first/persistence";

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
