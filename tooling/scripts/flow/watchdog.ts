/**
 * Flödesvaktens klocka: vilka saker har stått för länge i ett tillstånd eller
 * med en flagga, och vilka CI-körningar hänger. Rena funktioner — GitHub-
 * anropen ligger i `flow-watchdog.ts`.
 */
import type { Machine, Nudge, Timeout } from "./schema";

const HOUR = 3_600_000;

/** `4h` → millisekunder, `7d` → millisekunder. */
export function parseDuration(d: string): number {
  const n = Number(d.slice(0, -1));
  return d.endsWith("d") ? n * 24 * HOUR : n * HOUR;
}

/** En öppen issue/PR med de uppgifter klockan behöver. */
export interface WatchItem {
  number: number;
  labels: readonly string[];
  /** När varje etikett senast sattes (ISO). */
  labeledAt: Readonly<Record<string, string>>;
  /** Finns en öppen PR som stänger saken? */
  hasOpenPr: boolean;
}

/** Vad klockan ska göra med en sak. */
export interface WatchAction {
  number: number;
  remove: string;
  add: string | null;
  comment: string;
}

/** Etiketter i maskinen som har en timeout. */
export function timedLabels(machine: Machine): string[] {
  const states = Object.values(machine.states).flatMap((s) => (s.label !== null && s.timeout ? [s.label] : []));
  const flags = Object.entries(machine.flags).flatMap(([l, f]) => (f.timeout ? [l] : []));
  return [...states, ...flags];
}

function isDue(item: WatchItem, label: string, t: Timeout, now: number): boolean {
  const since = item.labeledAt[label];
  if (since === undefined) return false;
  if (t.unless === "open_pr" && item.hasOpenPr) return false;
  return now - new Date(since).getTime() >= parseDuration(t.after);
}

function timeoutOf(machine: Machine, label: string): { timeout: Timeout; add: string | null } | null {
  const flag = machine.flags[label];
  if (flag?.timeout) return { timeout: flag.timeout, add: null };
  const state = Object.values(machine.states).find((s) => s.label === label);
  if (!state?.timeout) return null;
  const target = state.timeout.to === undefined ? undefined : machine.states[state.timeout.to];
  return { timeout: state.timeout, add: target?.label ?? null };
}

/** Timeouter som har löpt ut, en åtgärd per sak och etikett. */
export function dueTimeouts(machine: Machine, items: readonly WatchItem[], now: number): WatchAction[] {
  const out: WatchAction[] = [];
  for (const item of items) {
    for (const label of item.labels) {
      const hit = timeoutOf(machine, label);
      if (hit && isDue(item, label, hit.timeout, now)) {
        out.push({ number: item.number, remove: label, add: hit.add, comment: hit.timeout.comment });
      }
    }
  }
  return out;
}

/** Tillståndsetiketter vars agent startas (dispatch) — de som kan knuffas. */
export function nudgeLabels(machine: Machine): string[] {
  return Object.values(machine.states).flatMap((s) => (s.label !== null && s.agent !== null && s.dispatch ? [s.label] : []));
}

/** En knuff: starta agenten för saken i tillståndet `label` igen. */
export interface NudgeAction { number: number; label: string; hours: number }

/**
 * Saker som stått för länge i ett tillstånd med en agent. Knuffas en gång per
 * `nudge.after` (klockan går varje timme): när åldern passerar 2 h, 4 h, 6 h …
 */
export function dueNudges(machine: Machine, nudge: Nudge, items: readonly WatchItem[], now: number): NudgeAction[] {
  const period = parseDuration(nudge.after);
  const labels = new Set(nudgeLabels(machine));
  return items.flatMap((item) => {
    if (item.labels.some((l) => nudge.skip_flags.includes(l))) return [];
    const label = item.labels.find((l) => labels.has(l));
    const since = label === undefined ? undefined : item.labeledAt[label];
    if (label === undefined || since === undefined) return [];
    const age = now - new Date(since).getTime();
    return age >= period && age % period < HOUR ? [{ number: item.number, label, hours: Math.floor(age / HOUR) }] : [];
  });
}

/** En CI-körning (GitHub Actions). */
export interface CiRun {
  id: number;
  status: string;
  startedAt: string;
}

/** Körningar som har stått i kö eller pågått längre än gränsen. */
export function hungRuns(runs: readonly CiRun[], now: number, minutes: number): number[] {
  const limit = minutes * 60_000;
  return runs
    .filter((r) => (r.status === "queued" || r.status === "in_progress") && now - new Date(r.startedAt).getTime() > limit)
    .map((r) => r.id);
}
