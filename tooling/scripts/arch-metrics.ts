#!/usr/bin/env bun
/**
 * Arkitekturmätning — underlaget till veckans arkitekturgenomgång
 * (`tooling/agents/5-arkitektur.md`, docs/feedback-pipeline.md).
 *
 * Deterministiskt, så trenden går att jämföra vecka för vecka: samma kod ger
 * samma siffror, oavsett vilken agent som kör. Mäter produktionskoden i
 * `src/` (inte tester):
 *
 *   - storlek per område (src/app, src/lib/server, …) och de största filerna,
 *   - churn senaste 7 dagarna (ändrade rader per fil),
 *   - hotspots = churn × storlek: stora filer som ändras ofta, där avdriften
 *     syns först,
 *   - duplicering (jscpd-rapporten, kör `bun run duplicates` först),
 *   - antal beroenden i package.json.
 *
 *   bun tooling/scripts/arch-metrics.ts [--previous förra.json] [--json ut.json]
 *
 * Skriver en markdown-tabell till stdout (med förändring mot `--previous`)
 * och, med `--json`, siffrorna som JSON för nästa veckas jämförelse.
 * Skyddat av Agentvakten: agenterna får inte ändra sin egen mätare.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";

const TOP = 10;

export const metricsSchema = z.object({
  generatedAt: z.string(),
  totalLines: z.number(),
  files: z.number(),
  linesByArea: z.record(z.string(), z.number()),
  largest: z.array(z.object({ path: z.string(), lines: z.number() })),
  hotspots: z.array(z.object({ path: z.string(), lines: z.number(), churn: z.number(), score: z.number() })),
  duplicationPercent: z.number().nullable(),
  dependencies: z.number(),
});
export type ArchMetrics = z.infer<typeof metricsSchema>;

/** `src/lib/server/routers/x.ts` → `src/lib/server`; `src/app/x/y.tsx` → `src/app`. */
export function areaOf(path: string): string {
  const parts = path.split("/");
  return parts[1] === "lib" ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/");
}

/** Produktionskod: .ts/.tsx under src/, inte tester. */
export function isProductionSource(path: string): boolean {
  return /^src\/.*\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path);
}

/** `git log --numstat --format=` → ändrade rader (tillagda + borttagna) per fil. Binärer (`-`) räknas inte. */
export function parseNumstat(text: string): Map<string, number> {
  const churn = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (!m?.[3]) continue;
    churn.set(m[3], (churn.get(m[3]) ?? 0) + Number(m[1]) + Number(m[2]));
  }
  return churn;
}

/** Bygg siffrorna ur filstorlekar och churn — ren, testbar. */
export function computeMetrics(
  sizes: ReadonlyMap<string, number>, churn: ReadonlyMap<string, number>,
  extra: { duplicationPercent: number | null; dependencies: number; generatedAt: string },
): ArchMetrics {
  const files = [...sizes].map(([path, lines]) => ({ path, lines }));
  const linesByArea: Record<string, number> = {};
  for (const f of files) linesByArea[areaOf(f.path)] = (linesByArea[areaOf(f.path)] ?? 0) + f.lines;
  const hotspots = files
    .map((f) => ({ ...f, churn: churn.get(f.path) ?? 0 }))
    .filter((f) => f.churn > 0)
    .map((f) => ({ ...f, score: f.churn * f.lines }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, TOP);
  return {
    generatedAt: extra.generatedAt,
    totalLines: files.reduce((s, f) => s + f.lines, 0),
    files: files.length,
    linesByArea,
    largest: [...files].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path)).slice(0, TOP),
    hotspots,
    duplicationPercent: extra.duplicationPercent,
    dependencies: extra.dependencies,
  };
}

/** "+12" / "−3" / "±0" — förändring mot förra veckan, eller tomt utan jämförelse. */
export function delta(now: number, before: number | undefined): string {
  if (before === undefined) return "";
  const d = Math.round((now - before) * 100) / 100;
  if (d === 0) return " (±0)";
  return d > 0 ? ` (+${d})` : ` (−${Math.abs(d)})`;
}

/** Markdown-rapporten (tabeller) — med förändring mot `previous` om den finns. */
export function formatMarkdown(m: ArchMetrics, previous?: ArchMetrics): string {
  const dup = m.duplicationPercent === null ? "okänd (kör `bun run duplicates`)" : `${m.duplicationPercent.toFixed(2)} %${delta(m.duplicationPercent, previous?.duplicationPercent ?? undefined)}`;
  const areas = Object.entries(m.linesByArea).sort((a, b) => b[1] - a[1])
    .map(([area, lines]) => `| \`${area}\` | ${lines}${delta(lines, previous?.linesByArea[area])} |`);
  return [
    "### Översikt",
    "",
    "| Mått | Värde |",
    "|---|---|",
    `| Rader produktionskod | ${m.totalLines}${delta(m.totalLines, previous?.totalLines)} |`,
    `| Filer | ${m.files}${delta(m.files, previous?.files)} |`,
    `| Duplicering | ${dup} |`,
    `| Beroenden (package.json) | ${m.dependencies}${delta(m.dependencies, previous?.dependencies)} |`,
    "",
    "### Rader per område",
    "",
    "| Område | Rader |",
    "|---|---|",
    ...areas,
    "",
    "### Hotspots (churn 7 d × storlek)",
    "",
    "| Fil | Rader | Ändrade rader 7 d |",
    "|---|---|---|",
    ...(m.hotspots.length ? m.hotspots.map((h) => `| \`${h.path}\` | ${h.lines} | ${h.churn} |`) : ["| (ingen churn) | | |"]),
    "",
    "### Största filerna",
    "",
    "| Fil | Rader |",
    "|---|---|",
    ...m.largest.map((f) => `| \`${f.path}\` | ${f.lines} |`),
  ].join("\n");
}

function git(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const jscpdSchema = z.object({ statistics: z.object({ total: z.object({ percentage: z.number() }) }) });
const packageSchema = z.object({ dependencies: z.record(z.string(), z.string()).default({}), devDependencies: z.record(z.string(), z.string()).default({}) });

function readSizes(): Map<string, number> {
  const paths = git(["ls-files", "src"]).split("\n").filter(isProductionSource);
  return new Map(paths.map((p) => [p, readFileSync(p, "utf8").split("\n").length]));
}

function readDuplication(): number | null {
  const file = "reports/jscpd/jscpd-report.json";
  return existsSync(file) ? parseJsonWith(jscpdSchema, readFileSync(file, "utf8")).statistics.total.percentage : null;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const pkg = parseJsonWith(packageSchema, readFileSync("package.json", "utf8"));
  const metrics = computeMetrics(readSizes(), parseNumstat(git(["log", "--since=7 days ago", "--numstat", "--format=", "--", "src"])), {
    duplicationPercent: readDuplication(),
    dependencies: Object.keys(pkg.dependencies).length + Object.keys(pkg.devDependencies).length,
    generatedAt: new Date().toISOString(),
  });
  const prevPath = argValue("--previous");
  const previous = prevPath ? parseJsonWith(metricsSchema, readFileSync(prevPath, "utf8")) : undefined;
  const jsonPath = argValue("--json");
  if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(`${formatMarkdown(metrics, previous)}\n`);
}

if (import.meta.main) main();
