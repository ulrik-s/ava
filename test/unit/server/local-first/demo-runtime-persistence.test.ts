/**
 * Tester för DemoRuntime + IPersistence-integration.
 *
 * Säkerställer att:
 *   - Vid `loadDemo()` sparas en snapshot via persistens-backenden.
 *   - Vid `restoreFromCache()` återställs entiteter utan att klona igen
 *     (offline-läge eller snabbstart).
 *   - Persistens är opt-in: utan persistence-arg fungerar runtime som förr.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import { InMemoryPersistence } from "@/lib/server/local-first/persistence";
import { demoSourceFromRuntime } from "@/lib/client/demo/demo-source-from-runtime";

const matter1 = JSON.stringify({
  id: "m1", matterNumber: "2026-0001", title: "T",
  status: "ACTIVE", organizationId: "demo",
});

describe("DemoRuntime — persistens", () => {
  it("loadDemo sparar snapshot via persistence när det är satt", async () => {
    const persistence = new InMemoryPersistence();
    const spy = vi.spyOn(persistence, "save");
    const rt = DemoRuntime.create({
      cloneFn: async (fs) => { await fs.writeFile("matters/active/m1.json", matter1); },
      persistence,
    });
    await rt.loadDemo("https://x/demo.git");
    expect(spy).toHaveBeenCalledTimes(1);
    const saved = spy.mock.calls[0]![0];
    expect(saved["matters/active/m1.json"]).toBeDefined();
  });

  it("restoreFromCache laddar entiteter utan att kalla cloneFn", async () => {
    // Steg 1: Anna kör en demo så cachen blir varm
    const persistence = new InMemoryPersistence();
    const cloneCount = vi.fn();
    const rt1 = DemoRuntime.create({
      cloneFn: async (fs) => {
        cloneCount();
        await fs.writeFile("matters/active/m1.json", matter1);
      },
      persistence,
    });
    await rt1.loadDemo("https://x/demo.git");
    expect(cloneCount).toHaveBeenCalledTimes(1);

    // Steg 2: ny session, samma persistence — restoreFromCache går
    // utan clone
    const cloneCount2 = vi.fn();
    const rt2 = DemoRuntime.create({
      cloneFn: async () => { cloneCount2(); },
      persistence,
    });
    const restored = await rt2.restoreFromCache();
    expect(restored).toBe(true);
    expect(cloneCount2).not.toHaveBeenCalled();
    expect(rt2.matters().findById("m1")).toMatchObject({ matterNumber: "2026-0001" });
  });

  it("restoreFromCache returnerar false när inget är cachat", async () => {
    const rt = DemoRuntime.create({
      cloneFn: async () => {},
      persistence: new InMemoryPersistence(),
    });
    expect(await rt.restoreFromCache()).toBe(false);
  });

  it("restoreFromCache utan persistence returnerar false", async () => {
    const rt = DemoRuntime.create({ cloneFn: async () => {} });
    expect(await rt.restoreFromCache()).toBe(false);
  });

  it("status() går idle → loaded efter framgångsrik restoreFromCache", async () => {
    const persistence = new InMemoryPersistence();
    const rt1 = DemoRuntime.create({
      cloneFn: async (fs) => { await fs.writeFile("matters/active/m1.json", matter1); },
      persistence,
    });
    await rt1.loadDemo("x");

    const rt2 = DemoRuntime.create({ cloneFn: async () => {}, persistence });
    expect(rt2.status()).toBe("idle");
    await rt2.restoreFromCache();
    expect(rt2.status()).toBe("loaded");
  });

  it("clearCache rensar persistens-storage", async () => {
    const persistence = new InMemoryPersistence();
    const rt = DemoRuntime.create({
      cloneFn: async (fs) => { await fs.writeFile("matters/active/m1.json", matter1); },
      persistence,
    });
    await rt.loadDemo("x");
    expect(await persistence.load()).not.toBeNull();

    await rt.clearCache();
    expect(await persistence.load()).toBeNull();
  });

  // ── Slab (writable, persisterad demo) ─────────────────────────────
  // writeBack i demo-läget skriver mutationer som filer i runtime:s MemFs
  // ("slaben under isomorphic-git") + persist() → snapshot till OPFS. En ny
  // session restore:ar slaben (inkl. mutationerna) istället för att klona om.

  it("slab: writeFile-mutation + persist överlever i en ny runtime (writable demo)", async () => {
    const persistence = new InMemoryPersistence();
    const rt1 = DemoRuntime.create({
      cloneFn: async (fs) => { await fs.writeFile("matters/active/m1.json", matter1); },
      persistence,
    });
    await rt1.loadDemo("x");
    // Runtime-mutation skriven till slaben (som demo-writeBack gör).
    const matter2 = JSON.stringify({
      id: "m2", matterNumber: "2026-0002", title: "Runtime", status: "ACTIVE", organizationId: "demo",
    });
    await rt1.writeFile("matters/active/m2.json", matter2);
    await rt1.persist();

    // Ny session, samma persistence → restore utan att klona om.
    const rt2 = DemoRuntime.create({
      cloneFn: async () => { throw new Error("ska inte klona — slaben ska restore:as"); },
      persistence,
    });
    expect(await rt2.restoreFromCache()).toBe(true);
    expect(rt2.matters().findById("m1")).toMatchObject({ matterNumber: "2026-0001" }); // seed kvar
    expect(rt2.matters().findById("m2")).toMatchObject({ matterNumber: "2026-0002" }); // mutationen överlevde
  });

  it("slab: genererat dokument-INNEHÅLL persisteras + kan läsas i ny runtime (blob-persistens)", async () => {
    const persistence = new InMemoryPersistence();
    const rt1 = DemoRuntime.create({ cloneFn: async () => {}, persistence });
    // Som demo-bootstrap:s ava:generated-doc-listener gör för en kostnadsräkning.
    const html = "<!doctype html><html><body>Kostnadsräkning B 2026-1234 ÅÄÖ</body></html>";
    await rt1.writeFile("documents/content/kostn-x.html", html);
    await rt1.persist();

    // Ny session → restore + rehydrera blob-cachen ur slaben.
    const rt2 = DemoRuntime.create({ cloneFn: async () => { throw new Error("ska inte klona"); }, persistence });
    expect(await rt2.restoreFromCache()).toBe(true);
    expect(await rt2.listFiles("documents/content")).toContain("kostn-x.html");
    expect(await rt2.readFile("documents/content/kostn-x.html")).toBe(html); // exakt, inkl. svenska tecken
  });

  it("slab: binärt innehåll (writeFileBytes) persisteras + läses tillbaka exakt", async () => {
    const persistence = new InMemoryPersistence();
    const rt1 = DemoRuntime.create({ cloneFn: async () => {}, persistence });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0xfe, 0xff, 0x80]); // %PDF + binärt
    await rt1.writeFileBytes("documents/content/k.pdf", bytes);
    await rt1.persist();

    const rt2 = DemoRuntime.create({ cloneFn: async () => { throw new Error("ska inte klona"); }, persistence });
    expect(await rt2.restoreFromCache()).toBe(true);
    const read = await rt2.readFileBytes("documents/content/k.pdf");
    expect(Array.from(read)).toEqual(Array.from(bytes)); // binärt bevarat byte-för-byte över persist/restore
  });

  it("slab: billingRun-mutation hydreras vid restore + når DemoSource (projection + source-key)", async () => {
    // Regression: faktureringsflöden skriver billing-runs/<id>.json till slaben,
    // men utan projection + ENTITY_TO_SOURCE_KEY-mappning droppades de vid restore
    // → "Inga billingruns ännu" efter reload.
    const persistence = new InMemoryPersistence();
    const rt1 = DemoRuntime.create({ cloneFn: async () => {}, persistence });
    const run = JSON.stringify({
      id: "br1", matterId: "m1", type: "KOSTNADSRAKNING", status: "PENDING_VERDICT",
      recipient: "OFFENTLIG_FORSVARARE", workValueOreAtRun: 670400,
    });
    await rt1.writeFile("billing-runs/br1.json", run);
    await rt1.persist();

    const rt2 = DemoRuntime.create({ cloneFn: async () => { throw new Error("ska inte klona"); }, persistence });
    expect(await rt2.restoreFromCache()).toBe(true);
    // Projektionen hydrerar entiteten …
    expect(rt2.allEntities().billingRun).toEqual([expect.objectContaining({ id: "br1", status: "PENDING_VERDICT" })]);
    // … och demoSourceFromRuntime mappar den till DemoSource.billingRuns.
    const source = demoSourceFromRuntime(rt2);
    expect(source.billingRuns).toEqual([expect.objectContaining({ id: "br1", matterId: "m1" })]);
  });

  it("persist() inkluderar slab-skrivningar; deleteFile tar bort dem", async () => {
    const persistence = new InMemoryPersistence();
    const rt = DemoRuntime.create({ cloneFn: async () => {}, persistence });
    await rt.writeFile("matters/active/x.json", matter1);
    await rt.persist();
    expect((await persistence.load())?.["matters/active/x.json"]).toBeDefined();

    await rt.deleteFile("matters/active/x.json");
    await rt.persist();
    expect((await persistence.load())?.["matters/active/x.json"]).toBeUndefined();
  });
});
