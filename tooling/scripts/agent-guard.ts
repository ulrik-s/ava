#!/usr/bin/env bun
/**
 * Agentvakten — CI-kontrollen som gör agentkedjans gränser MEKANISKA, inte
 * bara instruktioner i en prompt (docs/feedback-pipeline.md).
 *
 * En PR med etiketten `agent-pr` fälls om den:
 *   1. rör en skyddad sökväg (CI, deploy, auth, agentpromptarna, pengalogik,
 *      delade scheman, migrationer …),
 *   2. lägger till en destruktiv migration (samma regler som db:check-migrations
 *      och deployens automatiska rollback, lib/migration-kind.ts, #1770) — en
 *      rollback backar koden men aldrig databasen, så migrationer från agenter
 *      måste vara additiva (expand),
 *   3. är fler än taket (repovariabeln AGENT_PR_CAP, standard 30) agent-PR:er på 24
 *      timmar. Bara det som kan mergas räknas: mergade, och öppna utan `blockerad`;
 *      det Ulrik godkänt (`människa-godkänd`) räknas aldrig och stoppas aldrig,
 *   4. inte är godkänd av granskningsloopen (`granskad`) eller är `blockerad` —
 *      så auto-merge aldrig kan släppa igenom en ogranskad agent-PR.
 * (1)–(3) släpps igenom när Ulrik satt `människa-godkänd`. (4) gäller alltid.
 * PR:er utan `agent-pr` passerar direkt.
 *
 *   bun tooling/scripts/agent-guard.ts <pr-nummer>     (i CI, med GH_TOKEN)
 */

import { spawnSync } from "node:child_process";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { BASELINE_PATH, ROUTER_BASELINE_PATH } from "./file-size-ratchet";
import { labelIn, loadFlow, machineNamed } from "./flow/load";
import type { Flow } from "./flow/schema";
import { destructiveStatements } from "./lib/migration-kind";

/** Dygnstakets standard; repovariabeln `AGENT_PR_CAP` kan ändra det (`agentPrCap`). */
export const AGENT_PR_PER_DAY = 30;
/** Högsta tak repovariabeln får sätta: ett skrivfel ska inte släppa igenom allt. */
export const AGENT_PR_CAP_MAX = 200;

/**
 * Dygnstaket ur repovariabeln `AGENT_PR_CAP` (Ulrik, 2026-11-28): ett heltal
 * 1–200, annars standarden. Så kan taket höjas en dag i GitHubs inställningar
 * utan kodändring, och sänkas igen lika enkelt.
 */
export function agentPrCap(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.AGENT_PR_CAP?.trim() ?? "";
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return n >= 1 && n <= AGENT_PR_CAP_MAX ? n : AGENT_PR_PER_DAY;
}

/** Sökvägar en agent inte får röra utan `människa-godkänd`. */
export const PROTECTED_PATHS: readonly RegExp[] = [
  /^\.github\//,
  /^\.claude\//,
  /^tooling\/config\//,
  /^tooling\/docker\//,
  /^tooling\/systemd\//,
  /^tooling\/agents\//,
  /^tooling\/scripts\/(deploy|backup|restore|release|agent-guard|arch-metrics|file-size-ratchet)/,
  /^tooling\/scripts\/lib\//,
  /^tooling\/scripts\/flow/,
  /^src\/lib\/server\/auth\//,
  /^src\/lib\/server\/http\/(forwarded|server-context|node-http|server-first-api)/,
  /^src\/lib\/server\/feedback\//,
  /^src\/lib\/server\/routers\/feedback\.ts$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  // Pengalogik, delade scheman och migrationer (#1873): ett fel här når byråns
  // fakturor och bokföring direkt, och en migration går inte att backa.
  /^src\/lib\/shared\/schemas\//,
  /^tooling\/db\/migrations\//,
  /^src\/lib\/server\/billing\//,
  /^src\/lib\/shared\/billing\/(billing-[^/]*|kostnadsrakning[^/]*|coverage-billing|invoice-calc)\.ts$/,
  /^src\/lib\/server\/routers\/(invoice|billingRun)\.ts$/,
  /^src\/lib\/server\/routers\/billingRun\//,
  /^src\/lib\/shared\/billing\/(vat|invoice-vat|expense-vat|acconto-vat)\.ts$/,
  /^src\/lib\/shared\/billing\/(brottmalstaxa|forordnandetaxa)\.ts$/,
  /^src\/lib\/shared\/accounting\//,
];


export interface GuardInput {
  labels: readonly string[];
  /** Ändrade filer i PR:en. */
  files: readonly string[];
  /** Tillagda rader i migrationsfiler (`tooling/db/migrations/*.sql`). */
  addedMigrationLines: readonly string[];
  /** Agent-PR:er skapade de senaste 24 h fram till och med den här. */
  agentPrsLast24h: number;
  /** Ändrar PR:en storleksbaslinjerna bara åt det strängare hållet? */
  baselineOnlyTightens?: boolean;
  /** Dygnstaket (`agentPrCap()`); standard `AGENT_PR_PER_DAY`. */
  cap?: number;
}

/**
 * Filstorleksspärrens baslinje (tooling/config/, skyddad). En agent som krympt
 * en stor fil MÅSTE skärpa den, så just den filen får ändras i en agent-PR, men
 * bara åt det strängare hållet (lägre radantal, borttagna rader). Aldrig nya
 * filer, aldrig högre.
 */
export const FILE_SIZE_BASELINE = BASELINE_PATH;

/** Routertakets baslinje (#2176) — samma regel som filstorleksbaslinjen. */
export const ROUTER_SIZE_BASELINE = ROUTER_BASELINE_PATH;

/** Baslinjerna en agent-PR får skärpa (men aldrig luckra upp). */
const SIZE_BASELINES: readonly string[] = [FILE_SIZE_BASELINE, ROUTER_SIZE_BASELINE];

function isProtectedChange(file: string, input: GuardInput): boolean {
  if (SIZE_BASELINES.includes(file) && input.baselineOnlyTightens === true) return false;
  return PROTECTED_PATHS.some((p) => p.test(file));
}

const BASELINE_ENTRY = /^([+-])\s*"([^"]+)":\s*(\d+),?\s*$/;

/** Raderna i diffen som hör till `file` (mellan dess `---`/`+++`-rubrik och nästa fils). */
function diffLinesOf(diff: string, file: string): string[] {
  const out: string[] = [];
  let inFile = false;
  for (const line of diff.split("\n")) {
    if (/^(\+\+\+|---) /.test(line)) inFile = line.endsWith(file);
    else if (inFile) out.push(line);
  }
  return out;
}

/** Baslinjens rader med ett visst tecken (`+` tillagd, `-` borttagen): fil → radantal. */
function baselineEntries(lines: readonly string[], sign: "+" | "-"): Map<string, number> {
  return new Map(lines.flatMap((l) => {
    const m = BASELINE_ENTRY.exec(l);
    return m?.[1] === sign && m[2] ? [[m[2], Number(m[3])] as const] : [];
  }));
}

/** Ändrar diffen just den här baslinjen bara åt det strängare hållet? */
function fileDiffTightens(diff: string, file: string): boolean {
  const lines = diffLinesOf(diff, file);
  const removed = baselineEntries(lines, "-");
  return [...baselineEntries(lines, "+")].every(([path, n]) => (removed.get(path) ?? -1) >= n);
}

/** Ändrar diffen storleksbaslinjerna bara åt det strängare hållet? (Ingen ändring = sant.) */
export function baselineDiffTightens(diff: string): boolean {
  return SIZE_BASELINES.every((file) => fileDiffTightens(diff, file));
}

const DAY_MS = 24 * 3_600_000;

/**
 * PR:ens nummer i dygnstaket (#1954): agent-PR:er skapade de senaste 24
 * timmarna räknat från NU, till och med den här. Räknat från när PR:en
 * skapades föll en PR över taket vid varje omkörning, för alltid; nu går den
 * igenom när dygnet gått.
 */
export function rankInLast24h(createdAts: readonly string[], created: number, now: number): number {
  const since = now - DAY_MS;
  return createdAts.map((c) => new Date(c).getTime()).filter((t) => t >= since && t <= created).length;
}

/** Etiketterna vakten läser, uppslagna i flödets PR-maskin (`code-pr`). */
export interface GuardLabels { reviewed: string; blocked: string; humanApproved: string; agentPr: string }

/** Vaktens etiketter ur `flow.yaml`; kastar om flödet saknar någon av dem. */
export function guardLabels(flow: Flow): GuardLabels {
  const pr = machineNamed(flow, "code-pr");
  return {
    reviewed: labelIn(pr, "granskad"),
    blocked: labelIn(pr, "blockerad"),
    humanApproved: labelIn(pr, "människa-godkänd"),
    agentPr: labelIn(pr, "agent-pr"),
  };
}

/** Takradens början (#2158): klockan känner igen en vakt som bara föll på taket med den. */
export const CAP_LINE_START = "Taket är";

/**
 * Dygnstaket. En PR som Ulrik själv godkänt (labels är redan kontrollerade,
 * trustedLabels) stoppas aldrig av det: taket finns för att begränsa det som
 * landar hos honom, och den här har han sett (2026-11-28).
 */
function capViolations(input: GuardInput, labels: GuardLabels): string[] {
  const cap = input.cap ?? AGENT_PR_PER_DAY;
  if (input.labels.includes(labels.humanApproved) || input.agentPrsLast24h <= cap) return [];
  return [`${CAP_LINE_START} ${cap} agent-PR:er per dygn — den här är nr ${input.agentPrsLast24h}.`];
}

/** Regelbrotten i vaktens jobblogg: texten efter `✗ ` på varje rad som har det (tidsstämpeln före ignoreras). */
function loggedViolations(log: string): string[] {
  return log.split("\n").flatMap((line) => {
    const at = line.indexOf("✗ ");
    return at < 0 ? [] : [line.slice(at + 2)];
  });
}

/**
 * Föll vakten bara på dygnstaket (#2158)? Sant när loggen har minst en `✗`-rad
 * och alla är takraden, oavsett vilket tak som gällde då. En logg utan
 * `✗`-rader (infrastrukturfel) är falsk: det fallet äger PR-vakten.
 */
export function onlyCapViolation(log: string): boolean {
  const violations = loggedViolations(log);
  return violations.length > 0 && violations.every((v) => v.startsWith(`${CAP_LINE_START} `));
}

/** Vad som bryter mot reglerna — tom lista = godkänd. */
export function guardViolations(input: GuardInput, labels: GuardLabels): string[] {
  if (!input.labels.includes(labels.agentPr)) return [];
  const out = capViolations(input, labels);
  if (!input.labels.includes(labels.reviewed)) out.push(`Inte godkänd av granskningsloopen ännu (etiketten ${labels.reviewed} saknas).`);
  if (input.labels.includes(labels.blocked)) out.push("Blockerad — väntar på Ulrik.");
  if (input.labels.includes(labels.humanApproved)) return out;
  for (const f of input.files.filter((file) => isProtectedChange(file, input))) {
    out.push(`Skyddad sökväg: ${f} (kräver etiketten ${labels.humanApproved}).`);
  }
  for (const d of destructiveStatements(input.addedMigrationLines.join("\n"))) {
    out.push(`Destruktiv migration: ${d} — agentmigrationer ska vara additiva (kräver ${labels.humanApproved}).`);
  }
  return out;
}

/** Tillagda rader i migrationsfiler ur en unified diff. */
export function addedMigrationLines(diff: string): string[] {
  const out: string[] = [];
  let inMigration = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) inMigration = /tooling\/db\/migrations\/.*\.sql$/.test(line);
    else if (inMigration && line.startsWith("+")) out.push(line.slice(1));
  }
  return out;
}

/** En agent-PR som taket ser den: läge, etiketter och om den mergats. */
export interface CapPull { number: number; createdAt: string; state: string; merged: boolean; labels: readonly string[] }

/**
 * Räknas PR:en mot dygnstaket? Bara det som kan mergas (Ulrik, 2026-11-27): en
 * mergad PR, eller en öppen utan `blockerad`. En PR som väntar på Ulriks
 * `människa-godkänd` (`blockerad`) eller stängts utan merge levererar inget och
 * ska inte äta upp dygnets kvot; den 26/11 band sju sådana en fjärdedel av den.
 */
export function countsTowardCap(p: Omit<CapPull, "number" | "createdAt">): boolean {
  // Godkänd av Ulrik: räknas inte mot kvoten (2026-11-28), mergad eller ej.
  if (p.labels.includes("människa-godkänd")) return false;
  if (p.merged) return true;
  return p.state.toUpperCase() === "OPEN" && !p.labels.includes("blockerad");
}

/** Skapelsetiderna som räknas mot taket. PR:en som prövas räknas alltid själv. */
export function cappedCreatedAts(pulls: readonly CapPull[], self: number): string[] {
  return pulls.filter((p) => p.number === self || countsTowardCap(p)).map((p) => p.createdAt);
}

function gh(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const prViewSchema = z.object({
  labels: z.array(z.object({ name: z.string() })),
  files: z.array(z.object({ path: z.string() })),
  createdAt: z.string(),
});
const prListSchema = z.array(z.object({
  number: z.number(), createdAt: z.string(), state: z.string(), mergedAt: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string() })),
}));
const labelEventsSchema = z.array(z.array(z.object({
  event: z.string(),
  label: z.object({ name: z.string() }).optional(),
  actor: z.object({ login: z.string() }).nullable(),
  performed_via_github_app: z.unknown().nullable().optional(),
})));

/** En etiketthändelse: vem, och om det gjordes via en GitHub-app (en agent). */
export interface HumanLabelEvent { event: string; label: string; actor: string; viaApp: boolean }

/** Vem som får godkänna (`flow.ulrik`) och med vilken etikett (`människa-godkänd`). */
export interface Approver { ulrik: string; label: string }

/**
 * `människa-godkänd` räknas bara om Ulrik själv satte den: agenterna agerar i
 * hans namn via Claudes GitHub-app, så etiketten i sig bevisar ingenting.
 * Den SISTA händelsen för etiketten avgör.
 */
export function humanApproved(events: readonly HumanLabelEvent[], approver: Approver): boolean {
  const last = events.filter((e) => e.label === approver.label && (e.event === "labeled" || e.event === "unlabeled")).at(-1);
  return last !== undefined && last.event === "labeled" && last.actor === approver.ulrik && !last.viaApp;
}

function labelEvents(pr: string): HumanLabelEvent[] {
  const pages = parseJsonWith(labelEventsSchema, gh(["api", `repos/${process.env.GH_REPO ?? ""}/issues/${pr}/events?per_page=100`, "--paginate", "--slurp"]));
  return pages.flat().map((e) => ({ event: e.event, label: e.label?.name ?? "", actor: e.actor?.login ?? "", viaApp: e.performed_via_github_app != null }));
}

/** Etiketterna, utan `människa-godkänd` om den inte är satt av Ulrik själv. */
export function trustedLabels(labels: readonly string[], events: () => readonly HumanLabelEvent[], approver: Approver): string[] {
  if (!labels.includes(approver.label) || humanApproved(events(), approver)) return [...labels];
  console.error(`✗ ${approver.label} är inte satt av Ulrik själv — räknas inte.`);
  return labels.filter((l) => l !== approver.label);
}

function main(pr: string): number {
  const flow = loadFlow();
  const labels = guardLabels(flow);
  const view = parseJsonWith(prViewSchema, gh(["pr", "view", pr, "--json", "labels,files,createdAt"]));
  const created = new Date(view.createdAt).getTime();
  const now = Date.now();
  const since = new Date(now - DAY_MS).toISOString();
  const recent = parseJsonWith(prListSchema, gh(["pr", "list", "--state", "all", "--label", labels.agentPr, "--limit", "100", "--search", `created:>=${since}`, "--json", "number,createdAt,state,mergedAt,labels"]));
  const diff = gh(["pr", "diff", pr]);
  const violations = guardViolations({
    labels: trustedLabels(view.labels.map((l) => l.name), () => labelEvents(pr), { ulrik: flow.ulrik, label: labels.humanApproved }),
    files: view.files.map((f) => f.path),
    addedMigrationLines: addedMigrationLines(diff),
    baselineOnlyTightens: baselineDiffTightens(diff),
    agentPrsLast24h: rankInLast24h(cappedCreatedAts(recent.map((p) => ({
      number: p.number, createdAt: p.createdAt, state: p.state, merged: p.mergedAt != null, labels: p.labels.map((l) => l.name),
    })), Number(pr)), created, now),
    cap: agentPrCap(),
  }, labels);
  for (const v of violations) console.error(`✗ ${v}`);
  if (violations.length === 0) console.log("✓ agentvakten: inget att invända");
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  const pr = process.argv[2];
  if (!pr) { console.error("Användning: bun tooling/scripts/agent-guard.ts <pr-nummer>"); process.exit(2); }
  process.exit(main(pr));
}
