/**
 * Coverage-grind för bun:test (#92). Kör hela sviten med lcov-coverage,
 * summerar rader + funktioner över `src/` och faller om täckningen sjunker
 * under golvet. RATCHET: golvet flyttas bara uppåt (jfr gamla vitest-golvet).
 *
 * bun:test rapporterar bara rader + funktioner (inte branches/statements) —
 * medveten tradeoff vid vitest→bun-migrationen.
 *
 * Kör: `bun run test:cov`
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Förankrat strax under nuvarande lcov-mätning under --parallel (rader
// ~82.8% / funktioner ~79.5%). RATCHET — flytta bara uppåt.
// OBS: --parallel under-rapporterar mot --isolate (bun aggregerar coverage
// löst över workers), men deterministiskt → giltigt golv. --isolate kraschar
// på CI-linux (epoll_ctl EEXIST), så --parallel är den körbara vägen (#92).
const LINE_FLOOR = 0.82;
const FUNC_FLOOR = 0.79;
const LCOV = "coverage/lcov.info";

const TEST_GLOBS = ["test/unit", "test/integration", "test/scripts"];

function runTests(): void {
  const proc = spawnSync(
    "bun",
    // --parallel=2: cappar worker-processerna. Default = CPU-kärnor (4 på
    // ubuntu-latest) → för många samtidiga git-spawnande sviter (NodeGitOps,
    // git-ops-changed-files, server-working-copy) → `git clone` i tunga
    // beforeEach-hooks hängde sig (subprocess-I/O-kontention, samma epoll-
    // familj som --isolate-kraschen) och slog i timeout:en (#112, #116).
    // Färre workers = stabilt; Unit-jobbet är fortfarande snabbt.
    // --timeout 30000: realgit-tester är legitimt långsamma under kontention.
    ["test", "--parallel=2", "--timeout", "30000", "--coverage", "--coverage-reporter=lcov", ...TEST_GLOBS],
    { stdio: "inherit" },
  );
  if (proc.status !== 0) {
    console.error(`\n✗ Tester misslyckades (exit ${proc.status ?? "signal"}).`);
    process.exit(proc.status ?? 1);
  }
}

interface Totals {
  linesFound: number;
  linesHit: number;
  funcsFound: number;
  funcsHit: number;
}

// lcov-prefix → fält i Totals. Håller parseLcov platt (komplexitet ≤ 8).
const COUNTERS: ReadonlyArray<readonly [string, keyof Totals]> = [
  ["LF:", "linesFound"],
  ["LH:", "linesHit"],
  ["FNF:", "funcsFound"],
  ["FNH:", "funcsHit"],
];

function isSrcFile(sfLine: string): boolean {
  const p = sfLine.slice(3).replace(/\\/g, "/");
  return p.includes("/src/") || p.startsWith("src/");
}

/** Summera lcov, men bara för src/-filer. */
function parseLcov(text: string): Totals {
  const t: Totals = { linesFound: 0, linesHit: 0, funcsFound: 0, funcsHit: 0 };
  let inSrc = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) inSrc = isSrcFile(line);
    if (!inSrc) continue;
    const counter = COUNTERS.find(([prefix]) => line.startsWith(prefix));
    if (counter) t[counter[1]] += Number(line.slice(counter[0].length));
  }
  return t;
}

function main(): void {
  runTests();
  const t = parseLcov(readFileSync(LCOV, "utf8"));
  const lines = t.linesHit / t.linesFound;
  const funcs = t.funcsHit / t.funcsFound;
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`;
  console.log(`\nCoverage (src/): rader ${pct(lines)} (golv ${pct(LINE_FLOOR)}), funktioner ${pct(funcs)} (golv ${pct(FUNC_FLOOR)})`);

  const failures: string[] = [];
  if (lines < LINE_FLOOR) failures.push(`rader ${pct(lines)} < ${pct(LINE_FLOOR)}`);
  if (funcs < FUNC_FLOOR) failures.push(`funktioner ${pct(funcs)} < ${pct(FUNC_FLOOR)}`);
  if (failures.length > 0) {
    console.error(`✗ Coverage under golvet: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("✓ Coverage-grinden grön.");
}

main();
