/**
 * Arkitektur-som-tester — ArchUnit-stil fitness functions (issue #11).
 *
 * Lagerbrott ska synas i SAMMA flöde som vanliga tester, inte bara i en
 * separat `yarn deps:check`-körning. Det här testet kör dependency-cruiser
 * programmatiskt mot den KANONISKA regeluppsättningen
 * (`tooling/config/dependency-cruiser.cjs`) — single source of truth, ingen
 * duplicerad regel-logik här — och asserterar att lager-reglerna är gröna.
 *
 * Varför dependency-cruiser och inte `tsarch`: `tsarch@5.x` pinnar
 * `typescript@^3.8.3` och är ounderhållet; projektet kör TypeScript 6 och
 * dess egen rika lager-regeluppsättning finns redan i depcruise-konfigen.
 * Att återanvända den ger ArchUnit-stil fitness functions utan att hålla två
 * sanningar i synk.
 *
 * Varje `it()` motsvarar en regel i konfigen. Den avslutande catch-all-
 * testen failar på ALLA error-svåra brott (även framtida regler) så att en
 * ny regel automatiskt blir en del av sviten.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { cruise } from "dependency-cruiser";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const config = require(path.join(repoRoot, "tooling", "config", "dependency-cruiser.cjs"));

type Violation = {
  rule: { name: string; severity: string };
  from: string;
  to: string;
};

let violations: Violation[] = [];
let errorCount = 0;

beforeAll(async () => {
  const cruiseOptions = {
    ...config.options,
    ruleSet: { forbidden: config.forbidden },
    validate: true,
  };
  // Spegla `yarn deps:check`: cruisa både prod- och testkod (regeln
  // "produktionskod importerar inte testfiler" behöver test/ i grafen).
  const result = await cruise(
    [path.join(repoRoot, "src"), path.join(repoRoot, "test")],
    cruiseOptions,
  );
  // `result.output` är `string | ICruiseResult`; med validate:true och ingen
  // sträng-reporter är det alltid ICruiseResult. Narrowa explicit så tsc inte
  // tror att `.summary` saknas på sträng-grenen.
  if (typeof result.output === "string") {
    throw new Error("dependency-cruiser gav sträng-output — förväntade ICruiseResult");
  }
  violations = result.output.summary.violations as Violation[];
  errorCount = result.output.summary.error;
}, 60_000);

/** Brott (error-svåra) för en given regel, formaterade för läsbart fel-meddelande. */
function errorsForRule(name: string): string[] {
  // Säkerhets-grind: en stavfel-regel ger 0 brott och skulle annars "passera"
  // tyst. Verifiera att regeln faktiskt finns i konfigen.
  const exists = config.forbidden.some(
    (r: { name: string }) => r.name === name,
  );
  expect(exists, `regel "${name}" saknas i dependency-cruiser.cjs`).toBe(true);

  return violations
    .filter((v) => v.rule.name === name && v.rule.severity === "error")
    .map((v) => `${v.from} → ${v.to}`);
}

describe("Arkitektur — fitness functions (issue #11)", () => {
  it("inga cykler i src/lib (no-circular)", () => {
    expect(errorsForRule("no-circular")).toEqual([]);
  });

  it("shared beror inte uppåt mot client/server (shared-must-not-import-up)", () => {
    expect(errorsForRule("shared-must-not-import-up")).toEqual([]);
  });

  it("server-domän beror inte på UI (server-contracts-must-not-import-client)", () => {
    expect(errorsForRule("server-contracts-must-not-import-client")).toEqual([]);
  });

  it("UI rör server bara via typer (ui-imports-server-by-type-only)", () => {
    expect(errorsForRule("ui-imports-server-by-type-only")).toEqual([]);
  });

  it("kontrakt-lagret rör inte git-cache-internals (no-git-cache-in-contracts)", () => {
    expect(errorsForRule("no-git-cache-in-contracts")).toEqual([]);
  });

  it("produktionskod importerar inte testfiler (no-test-imports-from-prod)", () => {
    expect(errorsForRule("no-test-imports-from-prod")).toEqual([]);
  });

  it("inga importer av paket utanför package.json (no-non-package-json)", () => {
    expect(errorsForRule("no-non-package-json")).toEqual([]);
  });

  it("inga error-svåra arkitekturbrott totalt (catch-all för framtida regler)", () => {
    const allErrors = violations
      .filter((v) => v.rule.severity === "error")
      .map((v) => `[${v.rule.name}] ${v.from} → ${v.to}`);
    expect(allErrors).toEqual([]);
    expect(errorCount).toBe(0);
  });
});
