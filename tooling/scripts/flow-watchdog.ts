#!/usr/bin/env bun
/**
 * Flödesvaktens klocka: körs varje timme av GitHub Actions. Verkställer
 * timeouterna i tooling/agents/flow.yaml och avbryter CI som hänger.
 *
 *   bun tooling/scripts/flow-watchdog.ts <maskin> [<maskin> …] [--ci]
 *
 * FLOW_GUARD_MODE=enforce gör ändringarna; annars (report) loggas de bara.
 */
import { type GitHub, gitHub } from "./flow/github";
import { loadFlow } from "./flow/load";
import type { Machine } from "./flow/schema";
import { dueTimeouts, hungRuns, timedLabels, type WatchAction, type WatchItem } from "./flow/watchdog";
import type { Log } from "./flow-guard";

function lastAdded(gh: GitHub, n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of gh.labelEvents(n)) if (e.added) out[e.label] = e.at;
  return out;
}

function needsPrCheck(machine: Machine, labels: readonly string[]): boolean {
  return Object.values(machine.states).some((s) => s.timeout?.unless === "open_pr" && s.label !== null && labels.includes(s.label));
}

/** De öppna saker som bär en etikett med timeout, med tidpunkter. */
export function watchItems(machine: Machine, gh: GitHub): WatchItem[] {
  const timed = new Set(timedLabels(machine));
  return gh.openItems()
    .filter((i) => i.isPr === (machine.items === "pulls") && i.labels.some((l) => timed.has(l)))
    .map((i) => ({
      number: i.number,
      labels: i.labels,
      labeledAt: lastAdded(gh, i.number),
      hasOpenPr: needsPrCheck(machine, i.labels) && gh.hasOpenPr(i.number),
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

/** Avbryter CI-körningar som hänger. Ger deras id. */
export function cancelHung(gh: GitHub, now: number, minutes: number, enforce: boolean, log: Log): number[] {
  const ids = hungRuns(gh.activeRuns(), now, minutes);
  for (const id of ids) {
    log(`körning ${id} hänger > ${minutes} min${enforce ? " — avbryts" : " (bara rapport)"}`);
    if (enforce) gh.cancelRun(id);
  }
  return ids;
}

if (import.meta.main) {
  const flow = loadFlow();
  const enforce = process.env.FLOW_GUARD_MODE === "enforce";
  const args = process.argv.slice(2);
  const machines = args.filter((a) => !a.startsWith("--")).map((name) => flow.machines[name]);
  for (const m of machines) if (m) runTimeouts(m, gitHub(m.repo), Date.now(), enforce, console.log);
  const ciRepo = machines[0]?.repo;
  if (args.includes("--ci") && ciRepo) cancelHung(gitHub(ciRepo), Date.now(), flow.ci.hang_minutes, enforce, console.log);
}
