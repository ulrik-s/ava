/**
 * Diagnostik — app-wide singletons + hjälpare som binder ihop lagren:
 *
 *   1. self-detektion  → {@link reportSelfDetected} (invarianter → store + logg)
 *   2. logg-fångst     → {@link logBuffer} (console-ringbuffert)
 *   3. leverans        → {@link issueRepo} + report.ts (GitHub-prefill)
 *
 * Singletons (en buffer + en store per flik) lever modul-globalt. De rena
 * klasserna ([[log-buffer]], [[issue-store]]) testas isolerat; den här filen
 * är bara ihop-koppling + miljö-config.
 */

import { LogBuffer } from "./log-buffer";
import { IssueStore } from "./issue-store";
import { detectDomAnomalies } from "./dom-anomalies";
import { buildIssueReport, githubIssueNewUrl, type IssueReport } from "./report";
import { parseRepoLocator, type RepoLocator } from "@/lib/client/github/api";
import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";

/** App-wide console-/fel-ringbuffert. */
export const logBuffer = new LogBuffer(300);

/** App-wide store för självupptäckta fel. */
export const issueStore = new IssueStore();

/** Repo dit felrapporter prefill-länkas. Override: NEXT_PUBLIC_ISSUE_REPO. */
const FALLBACK_ISSUE_REPO = "ulrik-s/ava";

export function issueRepo(): RepoLocator {
  const configured = process.env.NEXT_PUBLIC_ISSUE_REPO;
  return (
    parseRepoLocator(configured ?? "") ??
    parseRepoLocator(FALLBACK_ISSUE_REPO) ?? { owner: "ulrik-s", repo: "ava" }
  );
}

/**
 * Rapportera självupptäckta överträdelser: lägg i store:n OCH logga via
 * `console.warn` så att de även hamnar i logg-bufferten (och i F12). Nya,
 * tidigare osedda fel loggas en gång — store:n dedupar.
 */
export function reportSelfDetected(violations: ReadonlyArray<InvariantViolation>): void {
  if (violations.length === 0) return;
  const added = issueStore.report(violations);
  if (added === 0) return;
  for (const v of violations) {
    console.warn(`[ava-invariant] ${v.code}: ${v.message}`, v.context);
  }
}

/** Hur många logg-rader som default bifogas (de senaste). */
export const DEFAULT_LOG_LINES = 50;

/**
 * Komponera en felrapport för den aktuella sessionen av singletons:erna:
 * användartext + alla självupptäckta fel + (valfritt) de senaste
 * console-raderna + miljö-metadata. Ren wrapper kring {@link buildIssueReport}.
 */
export function buildSessionReport(opts: { userText?: string; includeLogs?: boolean; maxLogs?: number }): IssueReport {
  const includeLogs = opts.includeLogs ?? true;
  return buildIssueReport({
    userText: opts.userText,
    violations: issueStore.list(),
    logs: includeLogs ? logBuffer.recent(opts.maxLogs ?? DEFAULT_LOG_LINES) : [],
    meta: collectMeta(),
  });
}

/** Komponera session-rapport + dess GitHub-prefill-URL i ett svep. */
export function buildSessionIssueUrl(opts: { userText?: string; includeLogs?: boolean; maxLogs?: number }): { report: IssueReport; url: string } {
  const report = buildSessionReport(opts);
  const url = githubIssueNewUrl({ repo: issueRepo(), title: report.title, body: report.body });
  return { report, url };
}

/** Samla miljö-metadata till felrapporten (defensivt mot SSR/node). */
export function collectMeta(): Record<string, string> {
  const meta: Record<string, string> = {};
  if (typeof window !== "undefined") {
    meta.url = window.location.href;
    meta.userAgent = window.navigator?.userAgent ?? "okänd";
    // Spår av DOM-muterande tillägg (vanlig orsak till React #418
    // hydrerings-mismatch). Tomt = inga kända spår hittade.
    const dom = typeof document !== "undefined" ? detectDomAnomalies(document) : "";
    if (dom) meta.domMiljö = dom;
  }
  const version = process.env.NEXT_PUBLIC_DEMO_VERSION;
  if (version) meta.version = version;
  return meta;
}
