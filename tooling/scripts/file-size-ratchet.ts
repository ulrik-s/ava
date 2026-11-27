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
 *
 * Routertaket (#2176): tRPC-routrarna (`src/lib/server/routers/`, även
 * undermapparna) har en egen, lägre gräns, ROUTER_MAX_LINES. En router ska
 * validera indata, välja procedur och anropa en tjänst under
 * `src/lib/server/<domän>/`; domänlogik som växer i routern flyttas dit.
 * Routrarna som redan var större står i `tooling/config/router-size-baseline.json`,
 * med samma regler: de får krympa men aldrig växa.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { readSourceSizes } from "./arch-metrics";

/** Högsta radantal för en produktionsfil. */
export const MAX_LINES = 400;

/** Högsta radantal för en tRPC-router (#2176). */
export const ROUTER_MAX_LINES = 250;

export const BASELINE_PATH = "tooling/config/file-size-baseline.json";

export const ROUTER_BASELINE_PATH = "tooling/config/router-size-baseline.json";

const baselineSchema = z.record(z.string(), z.number().int().positive());
export type Baseline = z.infer<typeof baselineSchema>;

/** En spärr: en radgräns för vissa filer, med en egen baslinje. */
export interface SizeCap {
  /** Vilka filer spärren gäller, i klartext. */
  label: string;
  /** Högsta radantal. */
  max: number;
  /** Gäller spärren filen? */
  applies: (path: string) => boolean;
  baselinePath: string;
  /** Vad man gör i stället för att låta filen växa. */
  advice: string;
}

/** En tRPC-router: allt under `src/lib/server/routers/`, även undermapparna. */
export function isRouterFile(path: string): boolean {
  return path.startsWith("src/lib/server/routers/");
}

export const PRODUCTION_CAP: SizeCap = {
  label: "produktionsfiler",
  max: MAX_LINES,
  applies: () => true,
  baselinePath: BASELINE_PATH,
  advice: "Dela upp filen.",
};

export const ROUTER_CAP: SizeCap = {
  label: "routrar",
  max: ROUTER_MAX_LINES,
  applies: isRouterFile,
  baselinePath: ROUTER_BASELINE_PATH,
  advice: "Flytta domänlogiken till en tjänst under src/lib/server/<domän>/.",
};

/** Alla spärrar, i den ordning de kontrolleras. */
export const CAPS: readonly SizeCap[] = [PRODUCTION_CAP, ROUTER_CAP];

export interface RatchetResult {
  /** Brott: en ny fil över gränsen, eller en baslinjefil som vuxit. */
  violations: string[];
  /** Baslinjen är för generös (fil krympt, under gränsen eller borta) — skärp med --update. */
  stale: string[];
}

function checkFile(path: string, lines: number, baseline: Baseline, cap: SizeCap): string | null {
  if (lines <= cap.max) return null;
  const allowed = baseline[path];
  if (allowed === undefined) return `${path}: ${lines} rader — över gränsen ${cap.max}. ${cap.advice}`;
  return lines > allowed ? `${path}: har vuxit från ${allowed} till ${lines} rader — får inte växa (gräns ${cap.max}).` : null;
}

function staleEntry(path: string, allowed: number, sizes: ReadonlyMap<string, number>, max: number): string | null {
  const lines = sizes.get(path);
  if (lines === undefined) return `${path}: finns inte längre`;
  if (lines <= max) return `${path}: ${lines} rader, under gränsen nu`;
  return lines < allowed ? `${path}: krympt från ${allowed} till ${lines}` : null;
}

/** Kontrollera filstorlekarna mot spärrens gräns och baslinje — ren, testbar. */
export function checkFileSizes(sizes: ReadonlyMap<string, number>, baseline: Baseline, cap: SizeCap = PRODUCTION_CAP): RatchetResult {
  return {
    violations: [...sizes].filter(([path]) => cap.applies(path))
      .flatMap(([path, lines]) => checkFile(path, lines, baseline, cap) ?? []).sort(),
    stale: Object.entries(baseline).flatMap(([path, allowed]) => staleEntry(path, allowed, sizes, cap.max) ?? []).sort(),
  };
}

/**
 * Skärpt baslinje: varje fil som står där och fortfarande är över gränsen får
 * sitt nuvarande radantal, om det är lägre. Inga nya filer, aldrig högre.
 */
export function tightenBaseline(sizes: ReadonlyMap<string, number>, baseline: Baseline, cap: SizeCap = PRODUCTION_CAP): Baseline {
  const next: Baseline = {};
  for (const [path, allowed] of Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))) {
    const lines = sizes.get(path);
    if (lines !== undefined && lines > cap.max) next[path] = Math.min(lines, allowed);
  }
  return next;
}

function readBaseline(cap: SizeCap): Baseline {
  return parseJsonWith(baselineSchema, readFileSync(cap.baselinePath, "utf8"));
}

/** Skriv ut spärrens brott och för generösa poster; ger antalet. */
function reportCap(cap: SizeCap, sizes: ReadonlyMap<string, number>): number {
  const { violations, stale } = checkFileSizes(sizes, readBaseline(cap), cap);
  for (const v of violations) console.error(`✗ ${v}`);
  for (const s of stale) console.error(`✗ ${cap.baselinePath} är för generös: ${s} — kör: bun run file-size --update`);
  if (violations.length === 0 && stale.length === 0) console.log(`✓ inga ${cap.label} över ${cap.max} rader utöver baslinjen`);
  return violations.length + stale.length;
}

function main(): number {
  const sizes = readSourceSizes();
  if (process.argv.includes("--update")) {
    for (const cap of CAPS) {
      writeFileSync(cap.baselinePath, `${JSON.stringify(tightenBaseline(sizes, readBaseline(cap), cap), null, 2)}\n`);
      console.log(`✓ ${cap.baselinePath} skärpt`);
    }
    return 0;
  }
  const failures = CAPS.reduce((n, cap) => n + reportCap(cap, sizes), 0);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
