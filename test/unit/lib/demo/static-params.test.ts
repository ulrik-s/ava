/**
 * Tester för demo-static-params: collectDemoIds + demoStaticParams.
 *
 * Använder in-process buildSeed() — single source of truth med seed-skrivning,
 * inga fetch-deps vid build-tid.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import { isUuid } from "@/lib/shared/uuid";

const realDemoBuild = process.env.DEMO_BUILD;

afterEach(() => {
  if (realDemoBuild === undefined) delete process.env.DEMO_BUILD;
  else process.env.DEMO_BUILD = realDemoBuild;
});

describe("collectDemoIds", () => {
  it("returnerar UUID-baserade matter-id:n (efter seed-translation till UUID v5)", async () => {
    const { collectDemoIds } = await import("@/lib/client/demo/static-params");
    const ids = await collectDemoIds("matters/active");
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((i) => isUuid(i))).toBe(true);
  });

  it("normaliserar trailing slash i prefix", async () => {
    const { collectDemoIds } = await import("@/lib/client/demo/static-params");
    const withSlash = await collectDemoIds("contacts/");
    const without = await collectDemoIds("contacts");
    expect(withSlash).toEqual(without);
    expect(withSlash.length).toBeGreaterThan(5);
  });

  it("returnerar [] när prefixen inte finns i seed", async () => {
    const { collectDemoIds } = await import("@/lib/client/demo/static-params");
    expect(await collectDemoIds("does-not-exist")).toEqual([]);
  });

  it("invoices → inkluderar deterministiska billing-id:n (collectBillingIds)", async () => {
    const { collectDemoIds } = await import("@/lib/client/demo/static-params");
    const ids = await collectDemoIds("invoices");
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((i) => typeof i === "string")).toBe(true);
  });

  it("payment-plans → billing-plan-id:n via collectBillingIds", async () => {
    const { collectDemoIds } = await import("@/lib/client/demo/static-params");
    const ids = await collectDemoIds("payment-plans");
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.every((i) => typeof i === "string")).toBe(true);
  });
});

describe("demoStaticParams — invoices/payment-plans kortsluts till bara sentinel", () => {
  beforeEach(() => { process.env.DEMO_BUILD = "1"; });

  it("invoices → ENDAST SHELL_PARAM (per-id-prerendering vore skadlig här)", async () => {
    const { demoStaticParams, SHELL_PARAM } = await import("@/lib/client/demo/static-params");
    expect(await demoStaticParams("invoices")).toEqual([{ id: SHELL_PARAM }]);
  });

  it("payment-plans → ENDAST SHELL_PARAM", async () => {
    const { demoStaticParams, SHELL_PARAM } = await import("@/lib/client/demo/static-params");
    expect(await demoStaticParams("payment-plans")).toEqual([{ id: SHELL_PARAM }]);
  });
});

describe("demoStaticParamsBySeedId", () => {
  afterEach(() => { delete process.env.DEMO_BUILD; });

  it("returnerar [] när DEMO_BUILD inte är satt", async () => {
    delete process.env.DEMO_BUILD;
    const { demoStaticParamsBySeedId } = await import("@/lib/client/demo/static-params");
    expect(await demoStaticParamsBySeedId("users")).toEqual([]);
  });

  it("läser seed-objektens .id (ej filnamn) + sentinel när DEMO_BUILD=1", async () => {
    process.env.DEMO_BUILD = "1";
    const { demoStaticParamsBySeedId, SHELL_PARAM } = await import("@/lib/client/demo/static-params");
    const params = await demoStaticParamsBySeedId("users");
    const ids = params.map((p) => p.id);
    // users-seeden har UUID-id:n (≠ filnamnet som är e-post)
    expect(ids.filter((i) => i !== SHELL_PARAM).length).toBeGreaterThan(0);
    expect(ids.filter((i) => i !== SHELL_PARAM).every((i) => isUuid(i))).toBe(true);
    expect(ids[ids.length - 1]).toBe(SHELL_PARAM);
  });

  it("okänd sourceKey → bara sentinel (tom lista + SHELL_PARAM)", async () => {
    process.env.DEMO_BUILD = "1";
    const { demoStaticParamsBySeedId, SHELL_PARAM } = await import("@/lib/client/demo/static-params");
    expect(await demoStaticParamsBySeedId("does-not-exist")).toEqual([{ id: SHELL_PARAM }]);
  });
});

describe("demoStaticParams", () => {
  beforeEach(() => { delete process.env.DEMO_BUILD; });

  it("returnerar [] när DEMO_BUILD inte är satt", async () => {
    const { demoStaticParams } = await import("@/lib/client/demo/static-params");
    expect(await demoStaticParams("matters/active")).toEqual([]);
  });

  it("inkluderar SHELL_PARAM-sentinel + UUID-id:n när DEMO_BUILD=1", async () => {
    process.env.DEMO_BUILD = "1";
    const { demoStaticParams, SHELL_PARAM } = await import("@/lib/client/demo/static-params");
    const params = await demoStaticParams("matters/active");
    const ids = params.map((p) => p.id);
    expect(ids).toContain(SHELL_PARAM);
    expect(ids.filter((i) => i !== SHELL_PARAM).every((i) => isUuid(i))).toBe(true);
    expect(ids[ids.length - 1]).toBe(SHELL_PARAM);
  });
});
