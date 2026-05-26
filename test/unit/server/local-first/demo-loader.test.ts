/**
 * Tester för `DemoLoader` — laddar en byrås demo-data från ett publikt
 * git-repo (typiskt på GitHub) och returnerar en "frusen" snapshot
 * av entiteter som kan visas i en demo-vy.
 *
 * Designval för testbarhet:
 *   - DI: `loader.clone()` tar en factory för isomorphic-git's clone
 *     så testen kan mocka utan att behöva starta riktig HTTP-server.
 *   - Hydrate-fas bygger på samma `ProjectionHydrator` som
 *     production-sync-loopen — DRY.
 */

import { describe, it, expect, vi } from "vitest";
import { DemoLoader } from "@/lib/server/local-first/demo-loader";
import { MemFs } from "@/lib/server/local-first/mem-fs";
import { buildDefaultRegistry } from "@/lib/server/local-first/projections/default-registry";

const sampleMatter = JSON.stringify({
  id: "m1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist (demo)",
  status: "ACTIVE",
  organizationId: "demo-org",
}, null, 2);

const sampleContact = JSON.stringify({
  id: "c1",
  name: "Anna Demo",
  contactType: "PERSON",
  organizationId: "demo-org",
}, null, 2);

describe("DemoLoader", () => {
  it("clone seedar fs:n med innehåll från en fake-clone-funktion", async () => {
    const fs = new MemFs();
    const cloneFn = vi.fn(async (target: MemFs) => {
      await target.writeFile("matters/active/m1.json", sampleMatter);
      await target.writeFile("contacts/c1.json", sampleContact);
    });
    const loader = new DemoLoader({
      fs,
      registry: buildDefaultRegistry(),
      cloneFn,
    });

    const result = await loader.loadDemo("https://github.com/ava/demo.git");

    expect(cloneFn).toHaveBeenCalledTimes(1);
    expect(result.entities.matter).toBe(1);
    expect(result.entities.contact).toBe(1);
    expect(result.url).toBe("https://github.com/ava/demo.git");
    expect(await fs.exists("matters/active/m1.json")).toBe(true);
  });

  it("entities() returnerar alla hydratiserade entiteter grupperat per typ", async () => {
    const fs = new MemFs();
    const cloneFn = async (target: MemFs) => {
      await target.writeFile("matters/active/m1.json", sampleMatter);
      await target.writeFile("contacts/c1.json", sampleContact);
    };
    const loader = new DemoLoader({ fs, registry: buildDefaultRegistry(), cloneFn });
    await loader.loadDemo("https://github.com/ava/demo.git");

    const all = loader.entities();
    expect(all.matter).toHaveLength(1);
    expect((all.matter[0] as { matterNumber: string }).matterNumber).toBe("2026-0001");
    expect(all.contact).toHaveLength(1);
  });

  it("kraschar inte om repo är tomt — returnerar 0 entities", async () => {
    const fs = new MemFs();
    const loader = new DemoLoader({
      fs,
      registry: buildDefaultRegistry(),
      cloneFn: async () => {},
    });
    const result = await loader.loadDemo("https://example/empty.git");
    expect(result.entities.matter ?? 0).toBe(0);
    expect(result.entities.contact ?? 0).toBe(0);
  });

  it("hoppar över korrupta JSON-filer + loggar fel", async () => {
    const fs = new MemFs();
    const cloneFn = async (target: MemFs) => {
      await target.writeFile("matters/active/m1.json", sampleMatter);
      await target.writeFile("matters/active/broken.json", "not json alls");
    };
    const loader = new DemoLoader({ fs, registry: buildDefaultRegistry(), cloneFn });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loader.loadDemo("https://example/x.git");
    expect(result.entities.matter).toBe(1);
    expect(result.errors).toHaveLength(1);
    spy.mockRestore();
  });

  it("flera demo-laddningar overskriver ren (data återställs varje load)", async () => {
    const fs = new MemFs();
    let counter = 0;
    const cloneFn = async (target: MemFs) => {
      counter++;
      await target.writeFile("matters/active/m1.json", JSON.stringify({
        id: "m1",
        matterNumber: `demo-${counter}`,
        title: "x",
        status: "ACTIVE",
        organizationId: "demo-org",
      }));
    };
    const loader = new DemoLoader({ fs, registry: buildDefaultRegistry(), cloneFn });

    await loader.loadDemo("a.git");
    expect((loader.entities().matter[0] as { matterNumber: string }).matterNumber).toBe("demo-1");

    await loader.loadDemo("a.git");
    expect((loader.entities().matter[0] as { matterNumber: string }).matterNumber).toBe("demo-2");
  });
});
