/**
 * Filstorleksspärren: inga nya filer över gränsen, baslinjefiler får inte
 * växa, och baslinjen kan bara skärpas — aldrig luckras upp.
 */
import { describe, expect, it } from "vitest-compat";
import {
  CAPS, checkFileSizes, isRouterFile, MAX_LINES, PRODUCTION_CAP, ROUTER_CAP, ROUTER_MAX_LINES, tightenBaseline,
} from "../../tooling/scripts/file-size-ratchet";

const over = MAX_LINES + 100;

describe("checkFileSizes", () => {
  it("allt under gränsen och tom baslinje: grönt", () => {
    expect(checkFileSizes(new Map([["src/a.ts", MAX_LINES]]), {})).toEqual({ violations: [], stale: [] });
  });

  it("ny fil över gränsen är ett brott", () => {
    const r = checkFileSizes(new Map([["src/ny.ts", MAX_LINES + 1]]), {});
    expect(r.violations).toEqual([expect.stringContaining("src/ny.ts")]);
  });

  it("baslinjefil på samma storlek är okej, men får inte växa", () => {
    expect(checkFileSizes(new Map([["src/stor.ts", over]]), { "src/stor.ts": over }).violations).toEqual([]);
    const grew = checkFileSizes(new Map([["src/stor.ts", over + 1]]), { "src/stor.ts": over });
    expect(grew.violations).toEqual([expect.stringContaining("har vuxit")]);
  });

  it.each([
    ["krympt", new Map([["src/stor.ts", over - 10]]), "krympt"],
    ["under gränsen", new Map([["src/stor.ts", MAX_LINES]]), "under gränsen"],
    ["borta", new Map<string, number>(), "finns inte längre"],
  ])("en för generös baslinje (%s) måste skärpas", (_label, sizes, text) => {
    expect(checkFileSizes(sizes, { "src/stor.ts": over }).stale).toEqual([expect.stringContaining(text)]);
  });
});

describe("tightenBaseline", () => {
  it("sänker, tar bort det som kommit under gränsen, lägger aldrig till och höjer aldrig", () => {
    const sizes = new Map([
      ["src/krympt.ts", over - 10],
      ["src/vuxit.ts", over + 50],
      ["src/under.ts", MAX_LINES - 1],
      ["src/ny.ts", over],
    ]);
    const baseline = { "src/krympt.ts": over, "src/vuxit.ts": over, "src/under.ts": over, "src/borta.ts": over };
    expect(tightenBaseline(sizes, baseline)).toEqual({ "src/krympt.ts": over - 10, "src/vuxit.ts": over });
  });
});

describe("routertaket (#2176)", () => {
  const router = "src/lib/server/routers/x.ts";
  const subRouter = "src/lib/server/routers/doc/core.ts";
  const overRouter = ROUTER_MAX_LINES + 50;

  it("gäller routrarna och deras undermappar, inget annat", () => {
    expect(isRouterFile(router)).toBe(true);
    expect(isRouterFile(subRouter)).toBe(true);
    expect(isRouterFile("src/lib/server/reports/x.ts")).toBe(false);
    expect(CAPS).toEqual([PRODUCTION_CAP, ROUTER_CAP]);
    expect(PRODUCTION_CAP.applies("src/lib/server/reports/x.ts")).toBe(true);
  });

  it("en router över routergränsen är ett brott, med råd om var logiken ska bo", () => {
    const r = checkFileSizes(new Map([[subRouter, ROUTER_MAX_LINES + 1]]), {}, ROUTER_CAP);
    expect(r.violations).toEqual([expect.stringContaining("src/lib/server/<domän>/")]);
    expect(checkFileSizes(new Map([[router, ROUTER_MAX_LINES]]), {}, ROUTER_CAP)).toEqual({ violations: [], stale: [] });
  });

  it("andra filer bryr sig routertaket inte om, hur stora de än är", () => {
    expect(checkFileSizes(new Map([["src/lib/server/reports/x.ts", overRouter]]), {}, ROUTER_CAP).violations).toEqual([]);
  });

  it("routerbaslinjen har samma ratchet: får inte växa, ska skärpas när den krymper", () => {
    expect(checkFileSizes(new Map([[router, overRouter]]), { [router]: overRouter }, ROUTER_CAP)).toEqual({ violations: [], stale: [] });
    expect(checkFileSizes(new Map([[router, overRouter + 1]]), { [router]: overRouter }, ROUTER_CAP).violations)
      .toEqual([expect.stringContaining("har vuxit")]);
    expect(checkFileSizes(new Map([[router, ROUTER_MAX_LINES]]), { [router]: overRouter }, ROUTER_CAP).stale)
      .toEqual([expect.stringContaining("under gränsen")]);
  });

  it("skärpningen räknar mot routergränsen", () => {
    const sizes = new Map([[router, overRouter - 10], [subRouter, ROUTER_MAX_LINES]]);
    expect(tightenBaseline(sizes, { [router]: overRouter, [subRouter]: overRouter }, ROUTER_CAP)).toEqual({ [router]: overRouter - 10 });
  });
});
