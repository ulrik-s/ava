/**
 * Tester för demo-static-params: collectDemoIds + demoStaticParams.
 *
 * Använder samma in-process buildSeed() som CI:n: ingen fetch, ingen
 * manifest — id:na kommer från seed-data:n direkt så vi inte behöver
 * vänta in en deploy-cykel mellan seed-skrivning och build.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const realDemoBuild = process.env.DEMO_BUILD;

afterEach(() => {
  if (realDemoBuild === undefined) delete process.env.DEMO_BUILD;
  else process.env.DEMO_BUILD = realDemoBuild;
});

describe("collectDemoIds", () => {
  it("returnerar matter-id:n från buildSeed", async () => {
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    const ids = await collectDemoIds("matters/active");
    // Seed innehåller flera matters (m-001 .. m-017+). Vi verifierar bara
    // att det inte är tomt och att brottmåls-id:na är med.
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.some((i) => i.startsWith("m-"))).toBe(true);
  });

  it("normaliserar trailing slash i prefix", async () => {
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    const withSlash = await collectDemoIds("contacts/");
    const without = await collectDemoIds("contacts");
    expect(withSlash).toEqual(without);
    expect(withSlash.length).toBeGreaterThan(5);
  });

  it("returnerar [] när prefixen inte finns i seed", async () => {
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("does-not-exist")).toEqual([]);
  });
});

describe("demoStaticParams", () => {
  beforeEach(() => { delete process.env.DEMO_BUILD; });

  it("returnerar [] när DEMO_BUILD inte är satt", async () => {
    const { demoStaticParams } = await import("@/client/lib/demo/static-params");
    expect(await demoStaticParams("matters/active")).toEqual([]);
  });

  it("inkluderar SHELL_PARAM-sentinel + seed-id:n när DEMO_BUILD=1", async () => {
    process.env.DEMO_BUILD = "1";
    const { demoStaticParams, SHELL_PARAM } = await import("@/client/lib/demo/static-params");
    const params = await demoStaticParams("matters/active");
    const ids = params.map((p) => p.id);
    expect(ids).toContain(SHELL_PARAM);
    expect(ids.some((i) => i.startsWith("m-"))).toBe(true);
    // Sentinel-shellen ska vara sist (efter alla seed-id:n)
    expect(ids[ids.length - 1]).toBe(SHELL_PARAM);
  });
});
