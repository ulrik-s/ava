/**
 * Tester för `DemoRuntime` — composition root för web-demoläget.
 *
 * Designmål (Liskov):
 *   - Exponerar en "subset av IDataStore" som UI:t kan läsa från
 *     (matters, contacts, ...) — read-only.
 *   - Writes är blockerade (kastar tydligt fel) — det är en demo.
 *
 * Tester använder fake-clone så de inte beror på GitHub.
 */

import { describe, it, expect, vi } from "vitest";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";

describe("DemoRuntime", () => {
  it("loadDemo populerar in-memory listor som UI:t kan läsa", async () => {
    const cloneFn = vi.fn(async (fs: import("@/lib/server/local-first/mem-fs").MemFs) => {
      await fs.writeFile("matters/active/m1.json", JSON.stringify({
        id: "m1", matterNumber: "2026-0001", title: "Demo-ärende",
        status: "ACTIVE", organizationId: "demo",
      }));
      await fs.writeFile("contacts/c1.json", JSON.stringify({
        id: "c1", name: "Demo Klient", contactType: "PERSON", organizationId: "demo",
      }));
    });
    const rt = DemoRuntime.create({ cloneFn });

    const result = await rt.loadDemo("https://github.com/ava/demo.git");
    expect(result.totalCount).toBe(2);

    expect(rt.matters().findById("m1")).toMatchObject({ matterNumber: "2026-0001" });
    expect(rt.contacts().findById("c1")).toMatchObject({ name: "Demo Klient" });
  });

  it("matters().list returnerar alla ärenden", async () => {
    const cloneFn = async (fs: import("@/lib/server/local-first/mem-fs").MemFs) => {
      for (let i = 1; i <= 3; i++) {
        await fs.writeFile(`matters/active/m${i}.json`, JSON.stringify({
          id: `m${i}`, matterNumber: `2026-000${i}`, title: `T${i}`,
          status: "ACTIVE", organizationId: "demo",
        }));
      }
    };
    const rt = DemoRuntime.create({ cloneFn });
    await rt.loadDemo("x");
    expect(rt.matters().list()).toHaveLength(3);
  });

  it("findById returnerar null för okänd entitet", async () => {
    const rt = DemoRuntime.create({ cloneFn: async () => {} });
    await rt.loadDemo("x");
    expect(rt.matters().findById("ghost")).toBeNull();
  });

  it("ny load ersätter tidigare data", async () => {
    let counter = 0;
    const cloneFn = async (fs: import("@/lib/server/local-first/mem-fs").MemFs) => {
      counter++;
      await fs.writeFile("matters/active/m.json", JSON.stringify({
        id: "m", matterNumber: `v${counter}`, title: "x",
        status: "ACTIVE", organizationId: "demo",
      }));
    };
    const rt = DemoRuntime.create({ cloneFn });
    await rt.loadDemo("a");
    expect((rt.matters<{matterNumber:string}>().findById("m"))?.matterNumber).toBe("v1");
    await rt.loadDemo("b");
    expect((rt.matters<{matterNumber:string}>().findById("m"))?.matterNumber).toBe("v2");
  });

  it("isReadOnly() är alltid true (demo blockerar writes)", () => {
    const rt = DemoRuntime.create({ cloneFn: async () => {} });
    expect(rt.isReadOnly()).toBe(true);
  });

  it("status() innan loadDemo är 'idle'", () => {
    const rt = DemoRuntime.create({ cloneFn: async () => {} });
    expect(rt.status()).toBe("idle");
  });

  it("status() blir 'loaded' efter framgångsrik load", async () => {
    const rt = DemoRuntime.create({ cloneFn: async () => {} });
    await rt.loadDemo("x");
    expect(rt.status()).toBe("loaded");
  });

  it("status() blir 'error' om cloneFn kastar", async () => {
    const rt = DemoRuntime.create({
      cloneFn: async () => { throw new Error("clone-fel"); },
    });
    await expect(rt.loadDemo("x")).rejects.toThrow();
    expect(rt.status()).toBe("error");
  });
});
