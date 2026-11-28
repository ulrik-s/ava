#!/usr/bin/env bun
/**
 * Flödesvaktens klocka: körs varje timme av GitHub Actions. Verkställer
 * timeouterna i tooling/agents/flow.yaml, knuffar, stänger dubblett-PR:er,
 * flyttar förfrågningar från kodrepot till inkorgen, speglar beroenden och
 * sätter den effektiva prioriteten (flow-deps.ts) och avbryter CI som hänger.
 *
 *   bun tooling/scripts/flow-watchdog.ts <maskin> [<maskin> …] [--ci]
 *
 * FLOW_GUARD_MODE=enforce gör ändringarna; annars (report) loggas de bara.
 */
import { agentPrCap, rankInLast24h } from "./agent-guard";
import { dispatchTarget, type FetchFn, fire } from "./flow/dispatch";
import { type GitHub, gitHub, runGhWithToken } from "./flow/github";
import { prioOrder } from "./flow/health";
import { markInternalParts, moveStrayIssues } from "./flow/inbox";
import { loadFlow } from "./flow/load";
import type { Flow, Machine } from "./flow/schema";
import {
  type AgentPull, closesIssue, type DuplicatePull, dueNudges, dueTimeouts, duplicatePulls, hungRuns, type MergedPull,
  nudgeLabels, timedLabels, type WatchAction, type WatchItem,
} from "./flow/watchdog";
import { runDependencies } from "./flow-deps";
import { type Log, normalize } from "./flow-guard";

function lastAdded(gh: GitHub, n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of gh.labelEvents(n)) if (e.added) out[e.label] = e.at;
  return out;
}

function needsPrCheck(machine: Machine, labels: readonly string[]): boolean {
  return Object.values(machine.states).some((s) => s.timeout?.unless === "open_pr" && s.label !== null && labels.includes(s.label));
}

/** De öppna saker som bär en etikett med timeout eller knuff, med tidpunkter. */
export function watchItems(machine: Machine, gh: GitHub): WatchItem[] {
  const timed = new Set([...timedLabels(machine), ...nudgeLabels(machine)]);
  return gh.openItems()
    .filter((i) => i.isPr === (machine.items === "pulls") && i.labels.some((l) => timed.has(l)))
    .map((i) => ({
      number: i.number,
      labels: i.labels,
      labeledAt: lastAdded(gh, i.number),
      hasOpenPr: needsPrCheck(machine, i.labels) && gh.hasOpenPr(i.number),
      ...((i.deps?.blockedBy ?? 0) > 0 ? { blocked: true } : {}),
    }));
}

function applyAction(gh: GitHub, a: WatchAction): void {
  gh.removeLabel(a.number, a.remove);
  if (a.add !== null) gh.addLabel(a.number, a.add);
  gh.comment(a.number, `Flödesvakten: ${a.comment}`);
}

/** Kör klockan för en maskin. Ger åtgärderna. */
export function runTimeouts(machine: Machine, gh: GitHub, now: number, enforce: boolean, log: Log): WatchAction[] {
  const actions = dueTimeouts(machine, watchItems(machine, gh), now);
  for (const a of actions) {
    log(`#${a.number}: ${a.remove} → ${a.add ?? "(bort)"}${enforce ? "" : " (bara rapport)"}`);
    if (enforce) applyAction(gh, a);
  }
  return actions;
}

/** Det knuffen behöver vid körning: klocka, hemligheter, fetch och utskrift. */
export interface NudgeContext {
  now: number;
  env: Readonly<Record<string, string | undefined>>;
  fetchFn: FetchFn;
  log: Log;
  /**
   * Antal starter per rutin i den här klockkörningen. En rutin tar alla saker i
   * sitt tillstånd, så `parallel` starter räcker (#1681, #1837).
   */
  started: Map<string, number>;
}

/** Knuffar saker som stått för länge: startar tillståndets agent igen, högst `parallel` gånger per rutin. Ger antal startade. */
export async function runNudges(flow: Flow, machine: Machine, items: readonly WatchItem[], ctx: NudgeContext): Promise<number> {
  const { now, env, fetchFn, log, started } = ctx;
  let fired = 0;
  for (const n of dueNudges(machine, flow.nudge, items, now)) {
    const target = dispatchTarget(flow, machine, n.label);
    if (!target) continue;
    const count = started.get(target.id) ?? 0;
    const again = count >= target.routine.parallel;
    log(`#${n.number}: knuff ${target.id} (${n.label}, ${n.hours} h)${again ? " — redan startad i den här körningen" : ""}`);
    if (again) continue;
    started.set(target.id, count + 1);
    const text = `Flödesvakten: ${machine.repo}#${n.number} har stått i ${n.label} i ${n.hours} h utan att något hänt.`;
    if (await fire(target, text, env[`ROUTINE_TOKEN_${target.id}`], fetchFn, log)) fired++;
  }
  return fired;
}

/** Etiketten på agenternas PR:er (flagga i flow.yaml:s code-pr). */
export const AGENT_PR = "agent-pr";

function agentPulls(gh: GitHub): AgentPull[] {
  return gh.openPulls().flatMap((p) => {
    const issue = closesIssue(p.body);
    return p.labels.includes(AGENT_PR) && issue !== null ? [{ number: p.number, issue, createdAt: p.createdAt ?? "" }] : [];
  });
}

/** Stänger dubblett-PR:er: två körningar som byggt samma issue (#1681). Ger dubbletterna. */
export function closeDuplicatePulls(gh: GitHub, enforce: boolean, log: Log): DuplicatePull[] {
  const open = agentPulls(gh);
  const merged = new Map<number, MergedPull>();
  for (const issue of new Set(open.map((p) => p.issue))) {
    const m = gh.mergedPullClosing(issue);
    if (m) merged.set(issue, m);
  }
  const dups = duplicatePulls(open, merged);
  for (const d of dups) {
    log(`#${d.number}: dubblett av #${d.keep}${enforce ? " — stängs" : " (bara rapport)"}`);
    if (!enforce) continue;
    gh.comment(d.number, `Flödesvakten: dubblett av #${d.keep}, som bygger samma issue (två körningar startade samtidigt). PR:en stängs; branchen kan tas bort.`);
    gh.closePull(d.number);
  }
  return dups;
}

/** Avbryter CI-körningar som hänger. Ger deras id. */
export function cancelHung(gh: GitHub, now: number, minutes: number, enforce: boolean, log: Log): number[] {
  const ids = hungRuns(gh.activeRuns(), now, minutes);
  for (const id of ids) {
    log(`körning ${id} hänger > ${minutes} min${enforce ? " — avbryts" : " (bara rapport)"}`);
    if (!enforce) continue;
    // En spökkörning (köad men inte startad) går inte att avbryta (409); den får inte stoppa klockan.
    try { gh.cancelRun(id); } catch (e) { log(`körning ${id} kunde inte avbrytas: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return ids;
}

const DAY_MS = 24 * 3_600_000;

/**
 * Var PR:en över dygnstaket när den skapades, men är under det nu? Agentvakten
 * räknar taket vid varje körning (#1955), men ingenting kör den igen när
 * fönstret har passerat (#2027) — det gör klockan.
 */
export function capReleased(created: number, createdAts: readonly string[], now: number, cap = agentPrCap()): boolean {
  return rankInLast24h(createdAts, created, created) > cap && rankInLast24h(createdAts, created, now) <= cap;
}

/** Kör om Agentvakten på granskade agent-PR:er som taket släppt. Ger PR-numren. */
export function rerunReleasedFromCap(gh: GitHub, now: number, enforce: boolean, log: Log): number[] {
  const createdAts = gh.agentPullsCreatedSince(new Date(now - 2 * DAY_MS).toISOString());
  const released = gh.openPulls().filter((p) =>
    p.labels.includes(AGENT_PR) && p.labels.includes("granskad") && !p.labels.includes("blockerad")
    && capReleased(Date.parse(p.createdAt ?? ""), createdAts, now));
  const rerun: number[] = [];
  for (const p of released) {
    // ponytail: en PR som också faller av ett annat skäl körs om varje timme tills taket inte längre gäller den (efter 24 h).
    if (!enforce) { log(`PR #${p.number}: under dygnstaket nu (bara rapport)`); continue; }
    try {
      if (gh.rerunFailedCheck(p.number, "Agentvakt")) { rerun.push(p.number); log(`PR #${p.number}: under dygnstaket nu — Agentvakten körs om`); }
    } catch (e) { log(`PR #${p.number}: Agentvakten kunde inte köras om: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return rerun;
}

if (import.meta.main) {
  const flow = loadFlow();
  const enforce = process.env.FLOW_GUARD_MODE === "enforce";
  const args = process.argv.slice(2);
  const machines = args.filter((a) => !a.startsWith("--")).map((name) => flow.machines[name]);
  const started = new Map<string, number>();
  const intakeRepo = flow.machines.intake?.repo;
  const token = process.env.FLOW_TRANSFER_TOKEN;
  for (const m of machines) {
    if (!m) continue;
    const gh = gitHub(m.repo);
    const codeIssues = m.items === "issues" && intakeRepo !== undefined && m.repo !== intakeRepo;
    // Beroendena först, så att knuffen ser vad som är blockerat. Ett fel där får inte stoppa klockan.
    if (codeIssues) {
      try { runDependencies(gh, prioOrder(flow), { enforce, log: console.log }); } catch (e) { console.log(`beroenden: ${e instanceof Error ? e.message : String(e)}`); }
    }
    // Saker med två tillstånd (en avbruten vaktkörning, #1781) städas varje timme.
    normalize(m, gh, enforce, console.log);
    runTimeouts(m, gh, Date.now(), enforce, console.log);
    if (enforce) await runNudges(flow, m, watchItems(m, gh), { now: Date.now(), env: process.env, fetchFn: fetch, log: console.log, started });
    if (m.items === "pulls") closeDuplicatePulls(gh, enforce, console.log);
    // Inkorgen: delar av en intern förfrågan får `intern`, som en agent inte får sätta (#2073).
    if (m.items === "issues" && m.repo === intakeRepo) markInternalParts(gh, m.repo, { enforce, log: console.log });
    // Inkorgen: en förfrågan i kodrepot flyttas till intaget (kräver en token som når båda).
    if (codeIssues) {
      const mover = token ? { source: gitHub(m.repo, runGhWithToken(token)), intake: gitHub(intakeRepo, runGhWithToken(token)), intakeRepo } : null;
      moveStrayIssues(gh, mover, { now: Date.now(), enforce, log: console.log });
    }
  }
  const ciRepo = machines[0]?.repo;
  if (args.includes("--ci") && ciRepo) {
    cancelHung(gitHub(ciRepo), Date.now(), flow.ci.hang_minutes, enforce, console.log);
    try { rerunReleasedFromCap(gitHub(ciRepo), Date.now(), enforce, console.log); } catch (e) { console.log(`dygnstaket: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
