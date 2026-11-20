#!/usr/bin/env bun
/**
 * Hälsokontrollen: körs av flödesvaktens klocka i ulrik-s/ava-feedback.
 * Samlar läget i båda repona, skriver statussidan "Agentkedjans status"
 * (issue med etiketten `agentstatus`) och nämner Ulrik i en kommentar — en
 * push i GitHubs app — när ett NYTT larm dyker upp.
 *
 *   bun tooling/scripts/flow-health.ts
 */
import { type GitHub, gitHub, intakeRefOf, type OpenItem } from "./flow/github";
import { type Alarm, healthReport, type HealthItem, type HealthReport, newAlarms, renderStatus } from "./flow/health";
import { loadFlow, stateLabels } from "./flow/load";
import type { Flow } from "./flow/schema";
import type { Log } from "./flow-guard";

const STATUS_LABEL = "agentstatus";
const CLOCK_WORKFLOW = "agent-flow.yml";

function lastAdded(gh: GitHub, n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of gh.labelEvents(n)) if (e.added) out[e.label] = e.at;
  return out;
}

/** Intagsnumren som en ÖPPEN implementations-issue pekar på (`Intag: ava-feedback#N`, loop 2). */
export function openIntakeRefs(items: readonly OpenItem[], intakeRepo: string): Set<number> {
  return new Set(items.flatMap((i) => {
    const n = i.isPr ? null : intakeRefOf(i.body, intakeRepo);
    return n === null ? [] : [n];
  }));
}

/** De öppna saker i flödet som har ett tillstånd eller är blockerade. */
export function collectItems(flow: Flow, ghFor: (repo: string) => GitHub): HealthItem[] {
  const open = new Map<string, OpenItem[]>();
  const openIn = (repo: string): OpenItem[] => open.get(repo) ?? open.set(repo, ghFor(repo).openItems()).get(repo) ?? [];
  const intake = flow.machines.intake?.repo;
  const codeRepo = Object.values(flow.machines).find((m) => m.repo !== intake)?.repo;
  const pending = intake && codeRepo ? openIntakeRefs(openIn(codeRepo), intake) : new Set<number>();
  return Object.values(flow.machines).flatMap((m) => {
    const gh = ghFor(m.repo);
    const relevant = new Set([...stateLabels(m), "blockerad"]);
    // PR:er via PR-ändpunkten: i intagets Action kom de inte med i issuelistan.
    const list = m.items === "pulls" ? gh.openPulls() : openIn(m.repo).filter((i) => !i.isPr);
    return list
      .filter((i) => i.labels.some((l) => relevant.has(l)))
      .map((i) => ({
        repo: m.repo, number: i.number, title: i.title, labels: i.labels, isPr: i.isPr,
        labeledAt: lastAdded(gh, i.number),
        ...(i.isPr && i.labels.includes("granskad") ? { mergeState: gh.prMergeState(i.number) } : {}),
        ...(m.repo === intake && i.labels.includes("nedbruten") && !pending.has(i.number) ? { awaitingRelease: true } : {}),
        ...(i.deps ? { blockedBy: i.deps.blockedBy, blocking: i.deps.blocking } : {}),
      }));
  });
}

/** När klockan senast gick: startad av en agent (dispatch) eller av GitHubs schema — inte etiketthändelser. */
export function lastClockRun(gh: GitHub): string | null {
  const times = ["event=workflow_dispatch", "event=schedule"].flatMap((f) => gh.lastRun(CLOCK_WORKFLOW, f)?.at ?? []);
  return times.sort().at(-1) ?? null;
}

const pushText =(alarms: readonly Alarm[], ulrik: string): string =>
  [`@${ulrik} Nytt i agentkedjan:`, "", ...alarms.map((a) => `- ${a.text}`)].join("\n");

/** Skriver statussidan och nämner Ulrik vid nya larm. Ger antalet nya larm. */
export function publishStatus(gh: GitHub, report: HealthReport, now: number, ulrik: string, log: Log): number {
  const body = renderStatus(report, now);
  const existing = gh.openItems().find((i) => !i.isPr && i.labels.includes(STATUS_LABEL));
  if (!existing) {
    gh.createIssue("Agentkedjans status", body, STATUS_LABEL);
    log("skapade statussidan");
  } else {
    gh.setBody(existing.number, body);
  }
  const fresh = newAlarms(report, existing?.body ?? "");
  if (existing && fresh.length > 0) gh.comment(existing.number, pushText(fresh, ulrik));
  log(`larm: ${report.alarms.length} (nya: ${fresh.length}), väntar på Ulrik: ${report.waitingForUlrik.length}`);
  return fresh.length;
}

if (import.meta.main) {
  const flow = loadFlow();
  const ghFor = (repo: string): GitHub => gitHub(repo);
  const ava = Object.values(flow.machines).find((m) => m.items === "pulls")?.repo ?? "ulrik-s/ava";
  const intake = flow.machines.intake?.repo ?? "ulrik-s/ava-feedback";
  const now = Date.now();
  const items = collectItems(flow, ghFor);
  console.log(`saker: ${items.length} (varav PR: ${items.filter((i) => i.isPr).length})`);
  const report = healthReport(flow, { now, items, lastClockRun: lastClockRun(ghFor(ava)) });
  publishStatus(ghFor(intake), report, now, flow.ulrik, console.log);
}
