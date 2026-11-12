#!/usr/bin/env bun
/**
 * Agentvakten — CI-kontrollen som gör agentkedjans gränser MEKANISKA, inte
 * bara instruktioner i en prompt (docs/feedback-pipeline.md).
 *
 * En PR med etiketten `agent-pr` fälls om den:
 *   1. rör en skyddad sökväg (CI, deploy, auth, agentpromptarna …),
 *   2. lägger till en destruktiv migration (DROP/RENAME/TRUNCATE/DELETE/typbyte) —
 *      en tagg-rollback backar koden men aldrig databasen, så migrationer från
 *      agenter måste vara additiva,
 *   3. är fler än AGENT_PR_PER_DAY agent-PR:er på 24 timmar,
 *   4. inte är godkänd av granskningsloopen (`granskad`) eller är `blockerad` —
 *      så auto-merge aldrig kan släppa igenom en ogranskad agent-PR.
 * (1) och (2) släpps igenom när Ulrik satt `människa-godkänd`. (3)–(4) gäller alltid.
 * PR:er utan `agent-pr` passerar direkt.
 *
 *   bun tooling/scripts/agent-guard.ts <pr-nummer>     (i CI, med GH_TOKEN)
 */

import { spawnSync } from "node:child_process";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";

export const AGENT_PR_PER_DAY = 20;

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
];

const DESTRUCTIVE_SQL = /\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|SCHEMA)|RENAME\s+(TO|COLUMN)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE)\b/i;

export interface GuardInput {
  labels: readonly string[];
  /** Ändrade filer i PR:en. */
  files: readonly string[];
  /** Tillagda rader i migrationsfiler (`tooling/db/migrations/*.sql`). */
  addedMigrationLines: readonly string[];
  /** Agent-PR:er skapade de senaste 24 h fram till och med den här. */
  agentPrsLast24h: number;
  /** Ändrar PR:en filstorleksbaslinjen bara åt det strängare hållet? */
  baselineOnlyTightens?: boolean;
}

/**
 * Filstorleksspärrens baslinje (tooling/config/, skyddad). En agent som krympt
 * en stor fil MÅSTE skärpa den, så just den filen får ändras i en agent-PR, men
 * bara åt det strängare hållet (lägre radantal, borttagna rader). Aldrig nya
 * filer, aldrig högre.
 */
export const FILE_SIZE_BASELINE = "tooling/config/file-size-baseline.json";

function isProtectedChange(file: string, input: GuardInput): boolean {
  if (file === FILE_SIZE_BASELINE && input.baselineOnlyTightens === true) return false;
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

/** Ändrar diffen baslinjen bara åt det strängare hållet? (Ingen ändring = sant.) */
export function baselineDiffTightens(diff: string): boolean {
  const lines = diffLinesOf(diff, FILE_SIZE_BASELINE);
  const removed = baselineEntries(lines, "-");
  return [...baselineEntries(lines, "+")].every(([path, n]) => (removed.get(path) ?? -1) >= n);
}

/** Vad som bryter mot reglerna — tom lista = godkänd. */
export function guardViolations(input: GuardInput): string[] {
  if (!input.labels.includes("agent-pr")) return [];
  const out: string[] = [];
  if (input.agentPrsLast24h > AGENT_PR_PER_DAY) {
    out.push(`Taket är ${AGENT_PR_PER_DAY} agent-PR:er per dygn — den här är nr ${input.agentPrsLast24h}.`);
  }
  if (!input.labels.includes("granskad")) out.push("Inte godkänd av granskningsloopen ännu (etiketten granskad saknas).");
  if (input.labels.includes("blockerad")) out.push("Blockerad — väntar på Ulrik.");
  if (input.labels.includes("människa-godkänd")) return out;
  for (const f of input.files.filter((file) => isProtectedChange(file, input))) {
    out.push(`Skyddad sökväg: ${f} (kräver etiketten människa-godkänd).`);
  }
  for (const line of input.addedMigrationLines.filter((l) => DESTRUCTIVE_SQL.test(l))) {
    out.push(`Destruktiv migration: "${line.trim()}" — agentmigrationer ska vara additiva (kräver människa-godkänd).`);
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
const prListSchema = z.array(z.object({ createdAt: z.string() }));
const labelEventsSchema = z.array(z.array(z.object({
  event: z.string(),
  label: z.object({ name: z.string() }).optional(),
  actor: z.object({ login: z.string() }).nullable(),
  performed_via_github_app: z.unknown().nullable().optional(),
})));

/** En etiketthändelse: vem, och om det gjordes via en GitHub-app (en agent). */
export interface HumanLabelEvent { event: string; label: string; actor: string; viaApp: boolean }

export const ULRIK = "ulrik-s";

/**
 * `människa-godkänd` räknas bara om Ulrik själv satte den: agenterna agerar i
 * hans namn via Claudes GitHub-app, så etiketten i sig bevisar ingenting.
 * Den SISTA händelsen för etiketten avgör.
 */
export function humanApproved(events: readonly HumanLabelEvent[]): boolean {
  const last = events.filter((e) => e.label === "människa-godkänd" && (e.event === "labeled" || e.event === "unlabeled")).at(-1);
  return last !== undefined && last.event === "labeled" && last.actor === ULRIK && !last.viaApp;
}

function labelEvents(pr: string): HumanLabelEvent[] {
  const pages = parseJsonWith(labelEventsSchema, gh(["api", `repos/${process.env.GH_REPO ?? ""}/issues/${pr}/events?per_page=100`, "--paginate", "--slurp"]));
  return pages.flat().map((e) => ({ event: e.event, label: e.label?.name ?? "", actor: e.actor?.login ?? "", viaApp: e.performed_via_github_app != null }));
}

/** Etiketterna, utan `människa-godkänd` om den inte är satt av Ulrik själv. */
export function trustedLabels(labels: readonly string[], events: () => readonly HumanLabelEvent[]): string[] {
  if (!labels.includes("människa-godkänd") || humanApproved(events())) return [...labels];
  console.error("✗ människa-godkänd är inte satt av Ulrik själv — räknas inte.");
  return labels.filter((l) => l !== "människa-godkänd");
}

function main(pr: string): number {
  const view = parseJsonWith(prViewSchema, gh(["pr", "view", pr, "--json", "labels,files,createdAt"]));
  const created = new Date(view.createdAt).getTime();
  const since = new Date(created - 24 * 3_600_000).toISOString();
  const recent = parseJsonWith(prListSchema, gh(["pr", "list", "--state", "all", "--label", "agent-pr", "--limit", "100", "--search", `created:>=${since}`, "--json", "number,createdAt"]));
  const diff = gh(["pr", "diff", pr]);
  const violations = guardViolations({
    labels: trustedLabels(view.labels.map((l) => l.name), () => labelEvents(pr)),
    files: view.files.map((f) => f.path),
    addedMigrationLines: addedMigrationLines(diff),
    baselineOnlyTightens: baselineDiffTightens(diff),
    agentPrsLast24h: recent.filter((p) => new Date(p.createdAt).getTime() <= created).length,
  });
  for (const v of violations) console.error(`✗ ${v}`);
  if (violations.length === 0) console.log("✓ agentvakten: inget att invända");
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  const pr = process.argv[2];
  if (!pr) { console.error("Användning: bun tooling/scripts/agent-guard.ts <pr-nummer>"); process.exit(2); }
  process.exit(main(pr));
}
