/**
 * Test-runner (#318). Delar upp sviten i två pass för att eliminera den
 * realgit-`--parallel`-flake som plågat lokala körningar + CI:
 *
 *   - Pass A — alla parallell-säkra tester, `--parallel=2` (in-memory/mockad
 *     git, rena enheter): snabbt.
 *   - Pass B — de realgit-tunga integrationstesterna (spawnar `git`-binären mot
 *     temp-repon): SEKVENTIELLT (inget `--parallel` → enprocess) → aldrig två
 *     git-`clone`/`commit`/`push` samtidigt → ingen subprocess-/IO-kontention.
 *
 * Bakgrund: `--parallel` (worker-pool) implicerar `--isolate`, som vid
 * EN worker (`--parallel=1`) kraschar på CI-linux (`epoll_ctl EEXIST`, #92).
 * Default-pool:en (= CPU-kärnor) och även `--parallel=2` schemalägger dessutom
 * ibland två realgit-filer samtidigt → timeouts / "git commit failed". Pass B
 * kör därför HELT utan `--parallel` (klassiskt enprocess-läge: ingen isolate,
 * ingen epoll-krasch, ingen kontention) — löser roten i stället för att höja
 * timeouten (band-aid, #112).
 *
 * Flaggor:
 *   --coverage  kör lcov-coverage i båda passen, slår ihop dem (per-rad-union)
 *               och fäller mot ratchet-golvet (ersätter check-coverage.ts).
 *   --fast      bara test/unit (matchar gamla test:fast).
 *
 * Kör: `bun run test` / `bun run test:fast` / `bun run test:cov`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const COVERAGE = process.argv.includes("--coverage");
const FAST = process.argv.includes("--fast");

// Ratchet-golv (flyttat hit från check-coverage.ts) — flytta BARA uppåt.
const LINE_FLOOR = 0.83;
const FUNC_FLOOR = 0.80;

/**
 * Realgit-tunga filer som spawnar `git`-binären mot temp-repon (#318). Körs
 * seriellt i pass B. Single source of truth — om en fil läggs till/flyttas
 * och listan blir inaktuell faller runnern (se assertKnown nedan).
 */
const REALGIT_FILES = [
  "test/unit/server/local-first/node-git-ops.test.ts",
  "test/unit/server/local-first/git-ops-changed-files.test.ts",
  "test/unit/server/local-first/sync-loop.integration.test.ts",
  "test/unit/server/local-first/server-peer.test.ts",
  "test/unit/server/local-first/server-runtime.test.ts",
  "test/unit/server/local-first/server-working-copy.write.test.ts",
];

const ROOTS = FAST ? ["test/unit"] : ["test/unit", "test/integration", "test/scripts"];

function allTestFiles(): string[] {
  const out = new Set<string>();
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root, { recursive: true })) {
      const rel = String(f).replace(/\\/g, "/");
      if (/\.test\.tsx?$/.test(rel)) out.add(`${root}/${rel}`);
    }
  }
  return [...out];
}

// Wall-clock-timeout per pass (#327). Realgit-passet (B) kan hänga indefinit
// om en git-barnprocess (clone/push mot temp-repo) blockerar — bun:s per-test-
// `--timeout` dödar inte alltid barnet, så hela processen lever vidare och
// HÄNGER jobbet tills GitHubs jobb-timeout (sågs som 15-min hang, PR #326).
// En SIGKILL-timeout gör en hang till ett bounded fel → snabb röd + rerun.
// Generöst tilltaget över normal körtid (pass A ~60s, pass B ~30s).
const PASS_A_TIMEOUT_MS = 360_000;
const PASS_B_TIMEOUT_MS = 240_000;

interface PassResult { status: number | null; signal: NodeJS.Signals | null; error?: Error | undefined }

/** Klassa ett spawnSync-resultat → felmeddelande (eller null = ok). Ren/testbar. */
export function passError(label: string, timeoutMs: number, r: PassResult): string | null {
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ETIMEDOUT") {
    return `${label}: översteg ${Math.round(timeoutMs / 1000)}s och dödades (SIGKILL) — trolig hängande git-barnprocess (#327). Kör om; undersök realgit-testet vid upprepning.`;
  }
  if (r.error) return `${label}: kunde inte köras: ${r.error.message}`;
  if (r.signal) return `${label}: dödad av signal ${r.signal}`;
  if (r.status !== 0) return `${label}: exit ${r.status ?? "okänd"}`;
  return null;
}

/**
 * Kör ett test-pass; avbryt processen om det fallerar (eller hänger > `timeoutMs`).
 *
 * `workers`:
 *   - `N` → `--parallel=N` (worker-pool; implicerar --isolate).
 *   - `null` → INGEN `--parallel` → klassiskt sekventiellt enprocess-läge.
 *     Används för realgit-passet: dels för att seriell körning eliminerar
 *     git-kontentionen, dels för att `--parallel` (även `=1`) implicerar
 *     --isolate som KRASCHAR på CI-linux (`epoll_ctl EEXIST`, #92). De
 *     realgit-tunga filerna saknar `mock.module`/globala stubbar → trygga att
 *     dela process.
 */
function runPass(label: string, files: string[], workers: number | null, covDir: string | null, timeoutMs: number): void {
  if (files.length === 0) return;
  const args = ["test", "--timeout", "30000"];
  if (workers !== null) args.push(`--parallel=${workers}`);
  if (covDir) args.push("--coverage", "--coverage-reporter=lcov", `--coverage-dir=${covDir}`);
  args.push(...files);
  // timeout + SIGKILL: en hängande pass dödas i st.f. att hänga hela jobbet (#327).
  const proc = spawnSync("bun", args, { stdio: "inherit", timeout: timeoutMs, killSignal: "SIGKILL" });
  const err = passError(label, timeoutMs, proc);
  if (err) {
    console.error(`\n✗ Tester misslyckades (${err}).`);
    process.exit(proc.status ?? 1);
  }
}

// ─── Coverage-merge (lcov per-rad/-funktion-union över de två passen) ──

// bun:test:s lcov-reporter avger DA: (per rad) + FNF:/FNH: (funktions-summa
// per fil) men INGA FN:/FNDA: (per-funktion). Därför: union rader exakt via DA;
// för funktioner tas per-fil-MAX av FNF/FNH (en fils instrumentering är
// identisk mellan passen → FNF lika; FNH-max är en konservativ union för de få
// filer som rörs i båda passen).
interface FileCov { lines: Map<number, number>; fnf: number; fnh: number }
interface Totals { linesFound: number; linesHit: number; funcsFound: number; funcsHit: number }

/** DA:<rad>,<antal> → union (max) av radens träffräknare. */
function mergeDA(cur: FileCov, line: string): void {
  const [ln, cnt] = line.slice(3).split(",").map(Number);
  if (ln !== undefined) cur.lines.set(ln, Math.max(cur.lines.get(ln) ?? 0, cnt ?? 0));
}

/** Slå ihop en lcov-rad (DA/FNF/FNH) in i den aktuella filens täckning. */
function mergeRecord(cur: FileCov, line: string): void {
  if (line.startsWith("DA:")) mergeDA(cur, line);
  else if (line.startsWith("FNF:")) cur.fnf = Math.max(cur.fnf, Number(line.slice(4)) || 0);
  else if (line.startsWith("FNH:")) cur.fnh = Math.max(cur.fnh, Number(line.slice(4)) || 0);
}

function mergeLcov(into: Map<string, FileCov>, text: string): void {
  let cur: FileCov | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      const p = line.slice(3).trim().replace(/\\/g, "/");
      cur = into.get(p) ?? { lines: new Map(), fnf: 0, fnh: 0 };
      into.set(p, cur);
    } else if (cur) {
      mergeRecord(cur, line);
    }
  }
}

const isSrc = (path: string): boolean => path.includes("/src/") || path.startsWith("src/");

/** Läs + union-merge:a lcov från alla pass-kataloger. */
function loadMerged(covDirs: string[]): Map<string, FileCov> {
  const merged = new Map<string, FileCov>();
  for (const dir of covDirs) {
    const lcov = `${dir}/lcov.info`;
    if (existsSync(lcov)) mergeLcov(merged, readFileSync(lcov, "utf8"));
  }
  return merged;
}

/** Räkna rad-/funktions-täckning över src/-filer. */
function tally(merged: Map<string, FileCov>): Totals {
  const t: Totals = { linesFound: 0, linesHit: 0, funcsFound: 0, funcsHit: 0 };
  for (const [path, cov] of merged) {
    if (!isSrc(path)) continue;
    for (const cnt of cov.lines.values()) { t.linesFound++; if (cnt > 0) t.linesHit++; }
    t.funcsFound += cov.fnf;
    t.funcsHit += cov.fnh;
  }
  return t;
}

function checkCoverage(covDirs: string[]): void {
  const t = tally(loadMerged(covDirs));
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

function main(): void {
  const all = allTestFiles();
  const realgitSet = new Set(REALGIT_FILES);
  const missing = REALGIT_FILES.filter((f) => !all.includes(f));
  if (missing.length > 0 && !FAST) {
    console.error(`✗ Inaktuell REALGIT_FILES-lista (#318) — saknas: ${missing.join(", ")}`);
    process.exit(1);
  }
  const realgit = all.filter((f) => realgitSet.has(f));
  const rest = all.filter((f) => !realgitSet.has(f));

  // Pass A: parallell-säkra tester (--parallel=2, snabbt). Pass B: realgit
  // sekventiellt (inget --parallel → enprocess, ingen kontention, ingen
  // --isolate/epoll-krasch på CI-linux).
  runPass("pass A (parallell)", rest, 2, COVERAGE ? "coverage/a" : null, PASS_A_TIMEOUT_MS);
  runPass("pass B (realgit, sekventiellt)", realgit, null, COVERAGE ? "coverage/b" : null, PASS_B_TIMEOUT_MS);

  if (COVERAGE) checkCoverage(["coverage/a", "coverage/b"]);
}

// Kör bara när scriptet körs direkt (`bun …/run-tests.ts`), inte när en test
// importerar `passError` härifrån (då skulle main() spawna en bun-test-körning).
if (process.argv[1]?.endsWith("run-tests.ts")) main();
