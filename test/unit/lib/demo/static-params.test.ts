/**
 * Tester för demo-static-params: collectDemoIds + demoStaticParams.
 *
 * Båda är build-time-helpers som kör i Node. Vi mockar global fetch och
 * styr DEMO_BUILD via process.env.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realFetch = globalThis.fetch;
const realDemoBuild = process.env.DEMO_BUILD;

function mockManifestFetch(paths: string[] | unknown, ok = true): void {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    json: async () => ({ paths }),
  } as Response)) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realDemoBuild === undefined) delete process.env.DEMO_BUILD;
  else process.env.DEMO_BUILD = realDemoBuild;
  vi.resetModules();
});

describe("collectDemoIds", () => {
  it("extraherar id:n från manifest-paths under prefix", async () => {
    mockManifestFetch([
      "matters/active/m-arvskifte.json",
      "matters/active/m-bostadsratt.json",
      "contacts/c-andersson.json", // annan prefix — ignoreras
      "matters/closed/m-old.json", // annan sub-prefix — ignoreras
    ]);
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("matters/active")).toEqual(["m-arvskifte", "m-bostadsratt"]);
  });

  it("normaliserar trailing slash i prefix", async () => {
    mockManifestFetch(["contacts/c-1.json", "contacts/c-2.json"]);
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("contacts/")).toEqual(["c-1", "c-2"]);
  });

  it("returnerar [] när manifest 404:ar", async () => {
    mockManifestFetch(["foo"], false);
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("matters")).toEqual([]);
  });

  it("returnerar [] när manifest saknar paths-array", async () => {
    mockManifestFetch("not-an-array");
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("matters")).toEqual([]);
  });

  it("returnerar [] när fetch kastar", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("network"); }) as typeof fetch;
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("matters")).toEqual([]);
  });
});

describe("demoStaticParams", () => {
  beforeEach(() => { delete process.env.DEMO_BUILD; });

  it("returnerar [] när DEMO_BUILD inte är satt", async () => {
    const { demoStaticParams } = await import("@/client/lib/demo/static-params");
    expect(await demoStaticParams("matters/active")).toEqual([]);
  });

  it("inkluderar SHELL_PARAM-sentinel + collectade id:n när DEMO_BUILD=1", async () => {
    process.env.DEMO_BUILD = "1";
    mockManifestFetch(["matters/active/m-1.json", "matters/active/m-2.json"]);
    const { demoStaticParams, SHELL_PARAM } = await import("@/client/lib/demo/static-params");
    const params = await demoStaticParams("matters/active");
    expect(params).toEqual([
      { id: "m-1" },
      { id: "m-2" },
      { id: SHELL_PARAM },
    ]);
  });

  it("returnerar bara sentinel-shell när manifest är tomt", async () => {
    process.env.DEMO_BUILD = "1";
    mockManifestFetch([]);
    const { demoStaticParams, SHELL_PARAM } = await import("@/client/lib/demo/static-params");
    expect(await demoStaticParams("matters/active")).toEqual([{ id: SHELL_PARAM }]);
  });
});
