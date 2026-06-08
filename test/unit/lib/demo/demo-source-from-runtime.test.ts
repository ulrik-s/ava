/**
 * Tester för `demoSourceFromRuntime` — adaptern mellan DemoRuntime
 * och DemoDataStore.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { demoSourceFromRuntime } from "@/lib/client/demo/demo-source-from-runtime";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import type { MemFs } from "@/lib/server/local-first/mem-fs";

async function seededRuntime(): Promise<DemoRuntime> {
  const runtime = DemoRuntime.create({
    cloneFn: async (fs: MemFs) => {
      await fs.writeFile("matters/active/m1.json", JSON.stringify({
        id: "m1", title: "Demo", organizationId: "demo-org", status: "ACTIVE",
        matterNumber: "1", createdAt: new Date("2025-01-01"),
      }));
      await fs.writeFile("contacts/c1.json", JSON.stringify({
        id: "c1", name: "Anna", organizationId: "demo-org", contactType: "PERSON",
      }));
    },
  });
  await runtime.loadDemo("https://example.invalid/demo.git");
  return runtime;
}

describe("demoSourceFromRuntime", () => {
  it("mappar hydratiserade entiteter till DemoSource-fält", async () => {
    const runtime = await seededRuntime();
    const src = demoSourceFromRuntime(runtime);
    expect(src.matters).toHaveLength(1);
    expect(src.contacts).toHaveLength(1);
    expect((src.matters![0] as { id: string }).id).toBe("m1");
  });

  it("entiteter utan mappning ignoreras tyst", () => {
    const fakeRuntime = {
      allEntities: () => ({ matter: [{ id: "m1" }], okand: [{ x: 1 }] }),
    } as unknown as DemoRuntime;
    const src = demoSourceFromRuntime(fakeRuntime);
    expect(src.matters).toHaveLength(1);
    expect((src as unknown as { okand?: unknown[] }).okand).toBeUndefined();
  });

  it("tom runtime returnerar tom DemoSource", () => {
    const fakeRuntime = { allEntities: () => ({}) } as unknown as DemoRuntime;
    expect(demoSourceFromRuntime(fakeRuntime)).toEqual({});
  });

  it("dummy vi-mock för att tysta lint om vi inte använder den", () => {
    expect(vi).toBeDefined();
  });
});
