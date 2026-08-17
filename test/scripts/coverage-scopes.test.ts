/**
 * Coverage-ratchet:ens MÄTOMRÅDEN (#1025).
 *
 * `run-tests-pass-error.test.ts` vaktar att ett fallerat pass klassas rätt.
 * Det här vaktar det andra sättet grinden kan bli verkningslös: att den mäter
 * fel filer. Före #1025 räknade `tally` bara `src/`, så hela AI-ytan
 * (`tooling/ava-cli/` — CLI:t + MCP-servern) låg utanför trots sju testfiler.
 * En sådan lucka syns inte i en grön körning; grinden var grön HELA tiden.
 *
 * Testerna är därför lika mycket regler som tester: områdena får inte tappas,
 * och golven får bara flyttas uppåt (ratchet-principen, docs/quality.md).
 */

import { describe, it, expect } from "vitest-compat";
import { COVERAGE_SCOPES, tally, type FileCov } from "../../tooling/scripts/run-tests";

const scopeFor = (label: string) => COVERAGE_SCOPES.find((s) => s.label === label);

/** En lcov-fil med `hit` täckta rader av `found`, och en täckt funktion. */
function cov(found: number, hit: number): FileCov {
  const lines = new Map<number, number>();
  for (let i = 1; i <= found; i++) lines.set(i, i <= hit ? 1 : 0);
  return { lines, fnf: 1, fnh: 1 };
}

describe("mätområden", () => {
  it("AI-ytan mäts — annars kan CLI:t och MCP-servern förfalla obemärkt", () => {
    const ai = scopeFor("tooling/ava-cli/");
    expect(ai, "tooling/ava-cli/ måste vara ett eget mätområde (#1025)").toBeDefined();
    expect(ai?.match("tooling/ava-cli/mcp.ts")).toBe(true);
    expect(ai?.match("tooling/ava-cli/tool-outputs.ts")).toBe(true);
  });

  it("appen mäts fortfarande", () => {
    const src = scopeFor("src/");
    expect(src?.match("src/lib/server/routers/billingRun.ts")).toBe(true);
  });

  it("områdena överlappar inte — en fil hör hemma i exakt ett", () => {
    // Överlapp vore värre än en lucka: AI-ytans dipp skulle delvis absorberas
    // av app-golvet och delvis fälla det, utan att någon förstod varför.
    for (const path of ["src/lib/shared/kostnadsrakning.ts", "tooling/ava-cli/cli.ts"]) {
      expect(COVERAGE_SCOPES.filter((s) => s.match(path)).map((s) => s.label), path).toHaveLength(1);
    }
  });

  it("verktygsskript utanför AI-ytan räknas inte in i den", () => {
    expect(scopeFor("tooling/ava-cli/")?.match("tooling/scripts/seed-data.ts")).toBe(false);
  });
});

describe("tally räknar bara sitt område", () => {
  const merged = new Map<string, FileCov>([
    ["src/a.ts", cov(10, 9)],
    ["tooling/ava-cli/mcp.ts", cov(10, 5)],
  ]);

  it("app-området ser inte AI-ytans rader", () => {
    const t = tally(merged, (p) => p.startsWith("src/"));
    expect({ found: t.linesFound, hit: t.linesHit }).toEqual({ found: 10, hit: 9 });
  });

  it("AI-ytan ser inte appens rader", () => {
    const t = tally(merged, (p) => p.includes("tooling/ava-cli/"));
    expect({ found: t.linesFound, hit: t.linesHit }).toEqual({ found: 10, hit: 5 });
  });
});

describe("golven är ratchets", () => {
  // Siffrorna speglar docs/quality.md. Sänks ett golv ska DEN ändringen vara
  // ett medvetet beslut som också uppdaterar det här testet — inte något som
  // glider igenom för att få en röd körning grön (AGENTS.md: gates only tighten).
  const FLOOR_BASELINE: Readonly<Record<string, { line: number; func: number }>> = {
    "src/": { line: 0.900, func: 0.859 },
    "tooling/ava-cli/": { line: 0.950, func: 0.920 },
  };

  for (const [label, base] of Object.entries(FLOOR_BASELINE)) {
    it(`${label} — golvet är inte sänkt`, () => {
      const scope = scopeFor(label);
      expect(scope, `mätområdet ${label} saknas`).toBeDefined();
      expect(scope?.lineFloor).toBeGreaterThanOrEqual(base.line);
      expect(scope?.funcFloor).toBeGreaterThanOrEqual(base.func);
    });
  }
});
