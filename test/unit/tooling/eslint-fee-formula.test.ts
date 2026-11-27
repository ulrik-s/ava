/**
 * Lintregeln mot inline-arvodesformeln (#2174).
 *
 * Formeln `(minuter / 60) * taxa` har EN plats: `timeEntryValueOre` i
 * `src/lib/shared/billing/whole-kronor.ts`. Testet läser regeln ur repots riktiga
 * ESLint-konfiguration (som den räknas fram för en given fil) och kör den på
 * kodsnuttar — så det är selektorn och kopplingen till filerna som prövas, inte
 * en kopia av dem.
 */
import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";

const severity = z.literal([0, 1, 2, "off", "warn", "error"]);
const restriction = z.object({ selector: z.string(), message: z.string() });
const restrictedSyntax = z.tuple([severity]).rest(restriction);
const configShape = z.object({ rules: z.object({ "no-restricted-syntax": restrictedSyntax }) });

const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: "tooling/config/eslint.config.mjs" });

/** `no-restricted-syntax` som den gäller för `path`. */
async function restrictedSyntaxFor(path: string): Promise<z.infer<typeof restrictedSyntax>> {
  return configShape.parse(await eslint.calculateConfigForFile(path)).rules["no-restricted-syntax"];
}

const isFeeRule = (message: string): boolean => message.includes("timeEntryValueOre");

/** Meddelandena om arvodesformeln när `code` lintas med regeln för `path`. */
async function feeHits(path: string, code: string): Promise<number> {
  const rule = await restrictedSyntaxFor(path);
  const messages = new Linter().verify(code, { rules: { "no-restricted-syntax": rule } });
  return messages.filter((m) => isFeeRule(m.message)).length;
}

const SHARED = "src/lib/shared/fee-probe.ts";

describe("lintregeln mot inline-arvodesformeln (#2174)", () => {
  it.each([
    ["(minuter / 60) * taxa", "const v = Math.round((t.minutes / 60) * (t.hourlyRate ?? 0));"],
    ["taxa * (minuter / 60)", "const v = rate * (minutes / 60);"],
    ["formeln i en summa", "let s = 0; s += Math.round((e.minutes / 60) * e.hourlyRate);"],
  ])("fäller %s", async (_name, code) => {
    expect(await feeHits(SHARED, code)).toBe(1);
  });

  it.each([
    ["timmar ur minuter", "const h = Math.floor(minutes / 60) * 60;"],
    ["arvodesfunktionen", "const v = timeEntryValueOre(minutes, rate);"],
    ["en namngiven timomräkning", "const hours = minutes / 60; const t = Math.round(hours * 10) / 10;"],
    ["division med något annat", "const v = (amount / 100) * rate;"],
  ])("släpper igenom %s", async (_name, code) => {
    expect(await feeHits(SHARED, code)).toBe(0);
  });

  it.each([
    "src/app/invoices/[id]/_client.tsx",
    "src/components/matter/coverage-cap-warning.tsx",
    "src/lib/server/routers/reports.ts",
    "tooling/scripts/reports-e2e.ts",
    "test/unit/server/routers/reports-work-value.test.ts",
  ])("gäller %s", async (path) => {
    expect(await feeHits(path, "const v = (minutes / 60) * rate;")).toBe(1);
  });

  it("formelns hem får skriva den — och behåller övriga förbud", async () => {
    const home = "src/lib/shared/billing/whole-kronor.ts";
    expect(await feeHits(home, "const v = (minutes / 60) * rate;")).toBe(0);
    const messages = (await restrictedSyntaxFor(home)).slice(1).map((r) => (typeof r === "object" ? r.message : ""));
    expect(messages.some((m) => m.includes("JSON.parse"))).toBe(true);
    expect(messages.some((m) => m.includes("toISOString"))).toBe(true);
  });
});
