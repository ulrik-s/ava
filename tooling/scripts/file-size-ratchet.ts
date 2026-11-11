#!/usr/bin/env bun
/**
 * Filstorleksspärren — en ratchet (docs/quality.md: grindar skärps bara).
 *
 * Stora filer är där avdriften syns först: de gör för mycket. Ingen
 * produktionsfil får därför växa förbi MAX_LINES rader. Filerna som redan var
 * större när spärren infördes står i `tooling/config/file-size-baseline.json`
 * med sitt radantal. De får krympa men aldrig växa. När en fil krymper (eller
 * kommer under gränsen) måste baslinjen skärpas, annars faller kontrollen, så
 * att ett vunnet utrymme inte kan ätas upp igen.
 *
 *   bun tooling/scripts/file-size-ratchet.ts            # kontroll (CI)
 *   bun tooling/scripts/file-size-ratchet.ts --update   # skärp baslinjen
 *
 * `--update` kan bara skärpa: den tar bort filer som kommit under gränsen och
 * sänker radantal, men lägger aldrig till filer och höjer aldrig. Baslinjen
 * ligger i `tooling/config/`, som Agentvakten skyddar.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { readSourceSizes } from "./arch-metrics";

/** Högsta radantal för en produktionsfil. */
export const MAX_LINES = 400;

export const BASELINE_PATH = "tooling/config/file-size-baseline.json";

const baselineSchema = z.record(z.string(), z.number().int().positive());
export type Baseline = z.infer<typeof baselineSchema>;

export interface RatchetResult {
  /** Brott: en ny fil över gränsen, eller en baslinjefil som vuxit. */
  violations: string[];
  /** Baslinjen är för generös (fil krympt, under gränsen eller borta) — skärp med --update. */
  stale: string[];
}

function checkFile(path: string, lines: number, baseline: Baseline): string | null {
  if (lines <= MAX_LINES) return null;
  const allowed = baseline[path];
  if (allowed === undefined) return `${path}: ${lines} rader — över gränsen ${MAX_LINES}. Dela upp filen.`;
  return lines > allowed ? `${path}: har vuxit från ${allowed} till ${lines} rader — får inte växa (gräns ${MAX_LINES}).` : null;
}

function staleEntry(path: string, allowed: number, sizes: ReadonlyMap<string, number>): string | null {
  const lines = sizes.get(path);
  if (lines === undefined) return `${path}: finns inte längre`;
  if (lines <= MAX_LINES) return `${path}: ${lines} rader, under gränsen nu`;
  return lines < allowed ? `${path}: krympt från ${allowed} till ${lines}` : null;
}

/** Kontrollera filstorlekarna mot gränsen och baslinjen — ren, testbar. */
export function checkFileSizes(sizes: ReadonlyMap<string, number>, baseline: Baseline): RatchetResult {
  return {
    violations: [...sizes].flatMap(([path, lines]) => checkFile(path, lines, baseline) ?? []).sort(),
    stale: Object.entries(baseline).flatMap(([path, allowed]) => staleEntry(path, allowed, sizes) ?? []).sort(),
  };
}

/**
 * Skärpt baslinje: varje fil som står där och fortfarande är över gränsen får
 * sitt nuvarande radantal, om det är lägre. Inga nya filer, aldrig högre.
 */
export function tightenBaseline(sizes: ReadonlyMap<string, number>, baseline: Baseline): Baseline {
  const next: Baseline = {};
  for (const [path, allowed] of Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))) {
    const lines = sizes.get(path);
    if (lines !== undefined && lines > MAX_LINES) next[path] = Math.min(lines, allowed);
  }
  return next;
}

function main(): number {
  const sizes = readSourceSizes();
  const baseline = parseJsonWith(baselineSchema, readFileSync(BASELINE_PATH, "utf8"));
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(tightenBaseline(sizes, baseline), null, 2)}\n`);
    console.log(`✓ ${BASELINE_PATH} skärpt`);
    return 0;
  }
  const { violations, stale } = checkFileSizes(sizes, baseline);
  for (const v of violations) console.error(`✗ ${v}`);
  for (const s of stale) console.error(`✗ baslinjen är för generös: ${s} — kör: bun run file-size --update`);
  if (violations.length === 0 && stale.length === 0) console.log(`✓ inga produktionsfiler över ${MAX_LINES} rader utöver baslinjen`);
  return violations.length + stale.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
