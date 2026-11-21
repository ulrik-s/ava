#!/usr/bin/env bun
/**
 * Spärren mot moduler som bara tester använder — en ratchet (docs/quality.md:
 * grindar skärps bara, #1764).
 *
 * Vanliga `bun run knip` räknar testfilerna som ingångar, så en modul i `src/`
 * som bara ett test importerar räknas som använd. Här körs knip i
 * produktionsläget (`--production`), där bara ingångarna märkta med `!` i
 * `tooling/config/knip.json` räknas och bara `src/` granskas. Modulerna som
 * redan flaggades när spärren infördes står i
 * `tooling/config/knip-production-baseline.json`. En ny flaggad modul fäller
 * spärren, och så gör en baslinjepost som inte längre flaggas: då ska
 * baslinjen skärpas med `--update`, så att ett vunnet läge inte kan förloras.
 *
 *   bun tooling/scripts/knip-production-ratchet.ts            # kontroll (CI)
 *   bun tooling/scripts/knip-production-ratchet.ts --update   # skärp baslinjen
 *
 * Knips exitkod räknas inte: knip avslutar med 1 när den hittar filer, även när
 * rapporten är giltig. Bara den lästa rapporten avgör.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { ratchetDiff } from "./ratchet";

export const BASELINE_PATH = "tooling/config/knip-production-baseline.json";

const KNIP_ARGS = ["--config", "tooling/config/knip.json", "--production", "--include", "files", "--reporter", "json"];

const baselineSchema = z.array(z.string());
const reportSchema = z.object({
  issues: z.array(z.object({ file: z.string(), files: z.array(z.object({ name: z.string() })) })),
});

export interface RatchetResult {
  /** Brott: en modul som bara tester använder och som inte står i baslinjen. */
  violations: string[];
  /** Baslinjen är för generös (modulen flaggas inte längre) — skärp med --update. */
  stale: string[];
}

/**
 * De flaggade sökvägarna ur knips JSON-rapport, sorterade — ren, testbar.
 * Kastar ett fel med stderr när stdout inte är en läsbar rapport.
 */
export function parseKnipReport(stdout: string, stderr: string): string[] {
  try {
    const report = parseJsonWith(reportSchema, stdout);
    return [...new Set(report.issues.flatMap((issue) => issue.files.map((f) => f.name)))].sort();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`knip gav ingen läsbar rapport (${reason})\n${stderr}`);
  }
}

/** Jämför de flaggade modulerna med baslinjen — ren, testbar. */
export function checkProductionOnlyFiles(flagged: readonly string[], baseline: readonly string[]): RatchetResult {
  const { added, gone } = ratchetDiff(flagged, baseline);
  return {
    violations: added.map((f) => `${f}: modulen används bara av tester: radera den, eller använd den i produktionskoden`),
    stale: gone.map((f) => `${f}: flaggas inte längre — kör: bun run knip:production --update`),
  };
}

/** Skärpt baslinje: det som inte längre flaggas tas bort. Ordningen behålls, inget läggs till. */
export function tightenBaseline(flagged: readonly string[], baseline: readonly string[]): string[] {
  const gone = new Set(ratchetDiff(flagged, baseline).gone);
  return baseline.filter((f) => !gone.has(f));
}

function runKnip(): string[] {
  const r = spawnSync("knip", KNIP_ARGS, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // Startar inte processen är stdout tomt (typerna säger string): läs då som tom rapport med felet.
  if (r.error) return parseKnipReport("", r.error.message);
  return parseKnipReport(r.stdout, r.stderr);
}

function report({ violations, stale }: RatchetResult): number {
  for (const v of violations) console.error(`✗ ${v}`);
  for (const s of stale) console.error(`✗ baslinjen är för generös: ${s}`);
  const ok = violations.length === 0 && stale.length === 0;
  if (ok) console.log("✓ inga moduler i src/ som bara tester använder utöver baslinjen");
  return ok ? 0 : 1;
}

function main(): number {
  const baseline = parseJsonWith(baselineSchema, readFileSync(BASELINE_PATH, "utf8"));
  let flagged: string[];
  try {
    flagged = runKnip();
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(tightenBaseline(flagged, baseline), null, 2)}\n`);
    console.log(`✓ ${BASELINE_PATH} skärpt`);
    return 0;
  }
  return report(checkProductionOnlyFiles(flagged, baseline));
}

if (import.meta.main) process.exit(main());
