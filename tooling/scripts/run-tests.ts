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
// #27: 84.0 → 84.8 (pick-provider) → 85.2 (external-edit-modal) → 85.5
// (verdict-dialog) → 85.7 (billing-dialog) → 85.8 (expected-receivables) → 86.0
// (integrations-section) → 86.2 (expectedReceivable) → 86.6 (DayView-render) →
// 86.7 (datasource-section) → 86.8 (extract-text pdf/docx) → 86.9 (reports
// arSummary-router) → 87.0 (paymentPlan list/cancel/scanDueReminders) → 87.1
// (document/core listDocumentTypes/markExternallyEdited/analyze-catch) → 87.2
// (calendar getById/listForMatter/setMirrorState, lokalt 87.89% rader, ~0.69%
// marginal — FUNC_FLOOR konservativt pga Node-version-varians) → 87.8 rader /
// 83.0 funktioner (ADR 0020 repo-migrering #409: alla routrar mot ctx.repos +
// per-repo paritetstester lyfte lokalt till 88.33% rader / 84.53% funktioner;
// golvet låses just under, ~0.5% rad-marginal / ~1.5% funktions-marginal för
// Node-version-varians) → 87.9 rader / 83.2 funktioner (#27: äkta
// WebCrypto-/IndexedDB-tester för ed25519-keypair lyfte lokalt till 88.38%
// rader / 84.89% funktioner; samma marginal-konvention behålls) → 88.0 rader /
// 83.4 funktioner (#27: smtp-sender + ExternalEditIndicator-tester lyfte lokalt
// till 88.46% rader / 84.97% funktioner; samma ~0.5%/~1.5%-marginal) → 88.0
// rader / 83.5 funktioner (#27: handle-store IndexedDB-persistens mot fake-
// indexeddb lyfte lokalt till 88.53% rader / 85.07% funktioner; FUNC-golvet
// låses just under 85%-milstolpen, LINE oförändrat ~0.5% marginal) → 88.1 rader
// / 83.5 funktioner (#27: demoStaticParamsBySeedId + billing-grenarna i static-
// params lyfte lokalt till 88.58% rader / 85.12% funktioner; LINE dras upp,
// FUNC oförändrat ~1.6% marginal) → 88.8 rader / 83.8 funktioner (#27:
// noop-ports + alla emit-helpers täckta efter server-first-migreringen, som
// dessutom tog bort otestad git/OPFS/mem-fs-kod → lokalt 90.50% rader / 85.11%
// funktioner; LINE-marginalen krymps mot den deterministiska kod-borttagningen
// medan FUNC behåller ~1.3% Node-version-marginal) → 88.9 rader / 84.0
// funktioner (#518: byte-synk + content-address + uploadContent/download +
// syncDocumentContent-wiring täckta → lokalt 90.70% rader / 85.51% funktioner;
// båda golven dras upp en knapp, ~1.5% FUNC-marginal behålls) → 88.9 rader /
// 84.1 funktioner (#27: icke-taxa-/timkostnadsnorm-grenen, timeEntries-
// specifikationen och vatRateLabel-varianterna i kostnadsräkningen testade →
// kostnadsrakning.ts 91%→100% rader, 15/20→20/20 funktioner; lokalt 90.74%
// rader / 85.64% funktioner. FUNC dras upp en knapp, ~1.5%-marginal behålls;
// LINE oförändrat — dess marginal är en avsiktlig Node-version-buffert) → 89.5
// rader / 84.1 funktioner (#27: MatterContactRepository.getByIdInOrg/findLink/
// listContactsForMatter/linkContact testade i båda impl:erna —
// drizzle-matter-contact-repository 68%→100% rader. #518 Fas 5 tog bort väl-
// testad klient-LLM-kod vilket krympte FUNC-marginalen, så FUNC lämnas vid 84.1
// (~1.37% marginal). LINE har legat stabilt ≥90.5% i ~5 PR → golvet dras upp
// till 89.5, ~1.18% marginal) → 89.5 rader / 84.2 funktioner (#27:
// ExpenseRepository.listUnfrozenForMatter/freezeForMatter/listForLawyerInPeriod
// testade i båda impl:erna → drizzle-expense-repository 77%→100% rader. Med de
// nyligen täckta repo-metoderna (folder/matter-contact) är FUNC-marginalen
// återhämtad efter #518 Fas 5 till ~1.45% → FUNC-golvet dras upp 84.1 → 84.2
// (~1.35% marginal, inom historiska 1.3–1.5%). LINE oförändrat (rader dippar
// till 90.64% på vissa körningar → 0.895 är nära taket) → 89.5 rader / 84.3
// funktioner (#27: TimeEntryRepository.listUnfrozenForMatter/freezeForMatter/
// listForLawyerInPeriod/listBillableForOrg testade → drizzle-time-entry 81%→100%.
// Repo-täckningssvepet (matter-contact/folder/expense/time-entry) klart →
// lokalt 90.77% rader / 85.63% funktioner. FUNC dras upp 84.2 → 84.3
// (~1.33% marginal). LINE oförändrat) → 89.5 rader / 84.5 funktioner (#27:
// demoCacheKey + ENTITY_REGISTRY.gitPath-callbacks för ALLA entiteter testade
// (registry-testet kallade tidigare aldrig callbackarna) → lokalt 90.67% rader /
// 85.87% funktioner. FUNC dras upp 84.3 → 84.5 (~1.37% marginal; funktions-
// täckning är Node-version-stabil till skillnad från branches). LINE oförändrat
// — dess marginal är en avsiktlig Node-version-buffert + lcov-line-bruset) →
// 89.5 rader / 84.6 funktioner (#27: query-engine endsWith/notIn (#598) +
// ReadOnlyDelegate _min/_max/findUniqueOrThrow → lokalt 85.99% funktioner.
// FUNC dras upp 84.5 → 84.6, ~1.39% marginal. LINE oförändrat) → 89.5 rader /
// 84.7 funktioner (#27: DataTable footer/summa-rader + grupp-summa + chip-
// borttagning + unhide-via-lista → data-table.tsx 57→65 funktioner, lokalt
// 86.10% funktioner. FUNC dras upp 84.6 → 84.7, ~1.40% marginal. LINE oförändrat)
// → 89.5 rader / 84.8 funktioner (#27: ExpenseSection skapa/edit-formulär +
// VatPreview + moms-radio/select-handlers → lokalt 86.28% funktioner. FUNC dras
// upp 84.7 → 84.8, ~1.48% marginal. LINE oförändrat) → 89.5 rader / 84.9
// funktioner (#27: TimeSection registrera/ändra/ta-bort-flöden + TimeForm-
// handlers → lokalt 86.48% funktioner. FUNC dras upp 84.8 → 84.9, ~1.58%
// marginal. LINE oförändrat) → 89.5 rader / 85.0 funktioner (#27:
// ContactsSection ny/befintlig-kontakt-formulär (PERSON/ORG-grenar, roll-
// select) → lokalt 86.57% funktioner. FUNC passerar 85%-milstolpen 84.9 → 85.0,
// ~1.57% marginal. LINE oförändrat) → 89.5 rader / 85.1 funktioner (#27:
// MattersPage NewMatterForm-fält (typ/målnr/beskrivning/taxeärende) + Föregående-
// paginering → lokalt 86.66% funktioner. FUNC dras upp 85.0 → 85.1, ~1.56%
// marginal. LINE oförändrat) → 89.5 rader / 85.3 funktioner (#27: TodoClient
// dag-navigering + toggle/create/edit/delete-flöden + användar-väljare → lokalt
// 86.95% funktioner / 91.13% rader. FUNC dras upp 85.1 → 85.3 (~1.65% marginal,
// konservativt pga större hopp). LINE oförändrat — lcov-line-brus + Node-buffert).
const LINE_FLOOR = 0.895;
const FUNC_FLOOR = 0.853;

/**
 * SERIAL_FILES — testfiler som SYNKRONT spawnar en barnprocess via
 * `execFileSync`/`spawnSync`: antingen git-binären mot temp-repon, eller
 * bash/bun/node (installer-script, dep-cruiser, manifest-generator). Körs
 * seriellt i pass B (inget `--parallel`).
 *
 * Varför seriellt (#327): en SYNKRON spawn från en bun `--parallel`-worker är
 * osäker på CI-linux. bun:s per-test-`--timeout` är asynkron och kan INTE
 * avbryta ett blockerande `execFileSync`/`spawnSync` — workern hänger då tills
 * pass-timeouten SIGKILL:ar (sågs som 360s-"git"-hang) ELLER så kraschar
 * worker-poolens epoll (`epoll_ctl EEXIST`). Båda felmoderna har SAMMA rot:
 * sync child-spawn under worker-poolen. Seriellt pass = inget pool/epoll →
 * trygg spawn. (#318 flyttade git-filerna hit; #327 generaliserade till alla
 * sync-spawnare — det hängande testet var test-all-seteexit, inte git.)
 *
 * Single source of truth. Regressionsvakten i main() fäller om (a) en fil här
 * saknas, eller (b) en pass-A-fil börjar sync-spawna utan att läggas till här.
 */
const SERIAL_FILES = [
  // sync-spawnare — bash/bun/node via execFileSync/spawnSync:
  "test/scripts/install-from-release.test.ts",
  "test/scripts/test-all-seteexit.test.ts",
  "test/unit/lib/generate-demo-manifest.test.ts",
  "test/unit/architecture/fitness.test.ts",
];

/** Matchar ett SYNKRONT child-spawn-anrop (regressionsvakt, #327). */
const SYNC_SPAWN_RE = /\b(?:execFileSync|spawnSync|execSync)\s*\(/;

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

// Wall-clock-timeout per pass (#327). Ett pass kan hänga indefinit om en
// SYNKRONT spawnad barnprocess (git/bash/bun/node) blockerar — bun:s per-test-
// `--timeout` är asynkron och avbryter inte ett `execFileSync`/`spawnSync`, så
// hela processen lever vidare och HÄNGER jobbet (sågs som 15-min hang, PR #326).
// En SIGKILL-timeout gör en hang till ett bounded fel → snabb röd + rerun.
// Generöst tilltaget över normal körtid (pass A ~60s, pass B ~30s).
const PASS_A_TIMEOUT_MS = 360_000;
const PASS_B_TIMEOUT_MS = 240_000;

interface PassResult { status: number | null; signal: NodeJS.Signals | null; error?: Error | undefined }

/** Klassa ett spawnSync-resultat → felmeddelande (eller null = ok). Ren/testbar. */
export function passError(label: string, timeoutMs: number, r: PassResult): string | null {
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ETIMEDOUT") {
    return `${label}: översteg ${Math.round(timeoutMs / 1000)}s och dödades (SIGKILL) — trolig hängande sync-spawnad barnprocess (git/bash/bun/node, #327). Kör om; sync-spawnande tester hör hemma i SERIAL_FILES.`;
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
  const serialSet = new Set(SERIAL_FILES);
  const missing = SERIAL_FILES.filter((f) => !all.includes(f));
  if (missing.length > 0 && !FAST) {
    console.error(`✗ Inaktuell SERIAL_FILES-lista (#318/#327) — saknas: ${missing.join(", ")}`);
    process.exit(1);
  }
  const serial = all.filter((f) => serialSet.has(f));
  const rest = all.filter((f) => !serialSet.has(f));

  // Regressionsvakt (#327): en pass-A-fil får ALDRIG synkront spawna en
  // barnprocess — det hänger/kraschar under bun:s --parallel-worker på
  // CI-linux. Fäll med tydligt besked om en sådan smyger in i parallell-passet.
  if (!FAST) {
    const leaked = rest.filter((f) => SYNC_SPAWN_RE.test(readFileSync(f, "utf8")));
    if (leaked.length > 0) {
      console.error(
        `✗ Sync-spawnande testfil(er) i parallell-passet (#327) — execFileSync/spawnSync\n` +
        `  hänger/kraschar under --parallel på CI-linux. Lägg till i SERIAL_FILES:\n  ${leaked.join("\n  ")}`,
      );
      process.exit(1);
    }
  }

  // Pass A: parallell-säkra tester (--parallel=2, snabbt). Pass B: sync-spawnare
  // (git/bash/bun/node) seriellt — inget --parallel → enprocess, ingen
  // kontention, ingen --isolate/epoll-krasch på CI-linux.
  runPass("pass A (parallell)", rest, 2, COVERAGE ? "coverage/a" : null, PASS_A_TIMEOUT_MS);
  runPass("pass B (seriell — sync-spawn)", serial, null, COVERAGE ? "coverage/b" : null, PASS_B_TIMEOUT_MS);

  if (COVERAGE) checkCoverage(["coverage/a", "coverage/b"]);
}

// Kör bara när scriptet körs direkt (`bun …/run-tests.ts`), inte när en test
// importerar `passError` härifrån (då skulle main() spawna en bun-test-körning).
if (process.argv[1]?.endsWith("run-tests.ts")) main();
