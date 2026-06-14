/**
 * Rapport-byggare — komponerar en felrapport (titel + markdown-body) av:
 *   - användarens fritext,
 *   - självupptäckta invariant-överträdelser ([[invariants]]),
 *   - de senaste console-utskrifterna ([[log-buffer]]),
 *   - lite miljö-metadata.
 *
 * Leverans (lager 3) sker via en GitHub "new issue"-prefill-länk: vi bygger
 * `https://github.com/<owner>/<repo>/issues/new?title=…&body=…` och öppnar i
 * ny flik. Det kräver varken token, server eller CORS — GitHub visar sitt
 * vanliga issue-formulär förifyllt och användaren trycker Submit själv.
 *
 * VIKTIGT: allt ligger i query-strängen, så vi trunkerar console-dumpen så
 * att hela URL:en håller sig under en konservativ längdgräns.
 *
 * Rena funktioner — ingen DOM. UI-lagret står för window.open/clipboard.
 */

import type { InvariantViolation as Violation } from "@/lib/shared/diagnostics/invariants";
import type { LogEntry } from "./log-buffer";

export interface RepoLocator {
  owner: string;
  repo: string;
}

export interface ReportInput {
  /** Användarens manuella beskrivning (valfri vid ren auto-rapport). */
  userText?: string;
  violations?: ReadonlyArray<Violation>;
  logs?: ReadonlyArray<LogEntry>;
  /** Miljö-metadata, t.ex. { tier, url, userAgent, version }. */
  meta?: Record<string, string>;
}

export interface IssueReport {
  title: string;
  body: string;
}

/** Konservativ tak-längd för hela issue-URL:en (GitHub/browsers trunkerar). */
export const DEFAULT_MAX_URL_LENGTH = 6000;

function buildTitle(input: ReportInput): string {
  const firstLine = input.userText?.split("\n")[0]?.trim();
  if (firstLine) return `[AVA] ${firstLine}`.slice(0, 120);
  if (input.violations && input.violations.length > 0) {
    return `[AVA] Självupptäckt: ${input.violations[0]!.code}`;
  }
  return "[AVA] Felrapport";
}

function metaSection(meta: Record<string, string> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  const rows = Object.entries(meta).map(([k, v]) => `- **${k}:** ${v}`);
  return `### Miljö\n${rows.join("\n")}\n`;
}

function violationsSection(violations: ReadonlyArray<Violation> | undefined): string {
  if (!violations || violations.length === 0) return "";
  const items = violations.map((v) => {
    const ctx = Object.entries(v.context).map(([k, val]) => `${k}=${val}`).join(", ");
    return `- **[${v.severity}] ${v.code}** — ${v.message}${ctx ? ` _(${ctx})_` : ""}`;
  });
  return `### Självupptäckta fel\n${items.join("\n")}\n`;
}

function logsSection(logs: ReadonlyArray<LogEntry> | undefined): string {
  if (!logs || logs.length === 0) return "";
  const lines = logs.map(
    (e) => `[${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()} ${e.text}`,
  );
  return "### Konsol-logg (senaste)\n```\n" + lines.join("\n") + "\n```\n";
}

/**
 * Bygg en strukturerad markdown-felrapport. Loggarna läggs sist så att de är
 * det som trunkeras bort först om URL:en blir för lång (se {@link githubIssueNewUrl}).
 */
export function buildIssueReport(input: ReportInput): IssueReport {
  const sections = [
    input.userText?.trim() ? `### Beskrivning\n${input.userText.trim()}\n` : "",
    violationsSection(input.violations),
    metaSection(input.meta),
    logsSection(input.logs),
  ].filter(Boolean);

  const body = sections.join("\n").trim() || "_Ingen beskrivning angavs._";
  return { title: buildTitle(input), body };
}

function buildUrl(repo: RepoLocator, title: string, body: string): string {
  const base = `https://github.com/${repo.owner}/${repo.repo}/issues/new`;
  const params = new URLSearchParams({ title, body });
  return `${base}?${params.toString()}`;
}

const TRUNCATION_MARKER = "\n\n_…loggen trunkerad för att passa URL-längden._";

/**
 * Bygg en GitHub "new issue"-prefill-URL och trunkera `body` vid behov så att
 * hela URL:en håller sig under `maxLength`. Trunkering tar bort tecken från
 * SLUTET av body (där console-loggen ligger) och lägger till en markör.
 *
 * Returnerar alltid en giltig URL — i värsta fall en med kraftigt nedkortad
 * body. Titeln kortas aldrig (den är redan ≤120 tecken).
 */
export function githubIssueNewUrl(args: {
  repo: RepoLocator;
  title: string;
  body: string;
  maxLength?: number;
}): string {
  const maxLength = args.maxLength ?? DEFAULT_MAX_URL_LENGTH;
  const full = buildUrl(args.repo, args.title, args.body);
  if (full.length <= maxLength) return full;

  // Binärsök fram längsta body-prefix som ryms (URL-encoding gör längden
  // icke-linjär, så vi mäter den faktiska URL:en per kandidat).
  const withMarker = (len: number): string =>
    buildUrl(args.repo, args.title, args.body.slice(0, len) + TRUNCATION_MARKER);

  let lo = 0;
  let hi = args.body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (withMarker(mid).length <= maxLength) lo = mid;
    else hi = mid - 1;
  }
  return withMarker(lo);
}
