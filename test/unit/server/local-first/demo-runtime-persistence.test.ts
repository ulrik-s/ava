/**
 * Tester för DemoRuntime + IPersistence-integration.
 *
 * Säkerställer att:
 *   - Vid `loadDemo()` sparas en snapshot via persistens-backenden.
 *   - Vid `restoreFromCache()` återställs entiteter utan att klona igen
 *     (offline-läge eller snabbstart).
 *   - Persistens är opt-in: utan persistence-arg fungerar runtime som förr.
 */

import { describe, it, expect, vi } from "vitest";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import { InMemoryPersistence } from "@/lib/server/local-first/persistence";

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
    const saved = spy.mock.calls[0][0];
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
});
