/**
 * Tester för demo-static-params i SPA-shell-läget.
 *
 * Vi pre-renderar inte HTML per seed-id längre — bara sentinel-shellen
 * så Next:s build inte klagar. Alla riktiga URL:er routar via 404.html →
 * SpaRedirectReader klientsidigt.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const realDemoBuild = process.env.DEMO_BUILD;

afterEach(() => {
  if (realDemoBuild === undefined) delete process.env.DEMO_BUILD;
  else process.env.DEMO_BUILD = realDemoBuild;
});

describe("demoStaticParams", () => {
  beforeEach(() => { delete process.env.DEMO_BUILD; });

  it("returnerar [] när DEMO_BUILD inte är satt", async () => {
    const { demoStaticParams } = await import("@/client/lib/demo/static-params");
    expect(await demoStaticParams("matters/active")).toEqual([]);
  });

  it("returnerar bara SHELL_PARAM-sentinel när DEMO_BUILD=1", async () => {
    process.env.DEMO_BUILD = "1";
    const { demoStaticParams, SHELL_PARAM } = await import("@/client/lib/demo/static-params");
    const params = await demoStaticParams("matters/active");
    expect(params).toEqual([{ id: SHELL_PARAM }]);
  });

  it("returnerar bara sentinel oavsett prefix (en HTML per dynamic route)", async () => {
    process.env.DEMO_BUILD = "1";
    const { demoStaticParams, SHELL_PARAM } = await import("@/client/lib/demo/static-params");
    expect(await demoStaticParams("contacts")).toEqual([{ id: SHELL_PARAM }]);
    expect(await demoStaticParams("payment-plans")).toEqual([{ id: SHELL_PARAM }]);
    expect(await demoStaticParams("invoices")).toEqual([{ id: SHELL_PARAM }]);
  });
});

describe("collectDemoIds (legacy stub)", () => {
  it("returnerar tom array — vi pre-renderar inte per id längre", async () => {
    const { collectDemoIds } = await import("@/client/lib/demo/static-params");
    expect(await collectDemoIds("matters/active")).toEqual([]);
  });
});
