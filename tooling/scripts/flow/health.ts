/**
 * Hälsokontrollen: invarianter över hela agentkedjan, och statussidan som
 * Ulrik tittar på i stället för att fråga. Rena funktioner — GitHub-anropen
 * ligger i `flow-health.ts`.
 */
import { stateLabels } from "./load";
import type { Flow, Machine } from "./schema";
import { parseDuration } from "./watchdog";

/** En öppen sak i ett repo, med de uppgifter kontrollen behöver. */
export interface HealthItem {
  repo: string;
  number: number;
  title: string;
  labels: readonly string[];
  /** När varje etikett senast sattes (ISO). */
  labeledAt: Readonly<Record<string, string>>;
  isPr: boolean;
  /** GitHubs `mergeable_state` för en PR (`clean` = grön och mergebar). */
  mergeState?: string;
  /** Nedbruten förfrågan utan öppna implementations-issues: klar, väntar bara på nästa release. */
  awaitingRelease?: boolean;
  /** Nedbruten förfrågan vars arbetsordrar fortfarande är öppna: väntar på kön i ava, inte på en agent. */
  awaitingWork?: boolean;
  /** Öppna GitHub-beroenden: blockerare den väntar på, och saker som väntar på den. */
  blockedBy?: number;
  blocking?: number;
}

/** Läget i hela kedjan vid ett tillfälle. */
export interface HealthSnapshot {
  now: number;
  items: readonly HealthItem[];
  /** När flödesvaktens klocka senast gick (ISO), eller null. */
  lastClockRun: string | null;
}

/** Något som är fel och inte rättar sig självt. */
export interface Alarm { key: string; text: string }

/** Resultatet: larm, vad som väntar på Ulrik och vad som rör sig. */
export interface HealthReport {
  alarms: Alarm[];
  waitingForUlrik: string[];
  moving: string[];
}

const HOUR = 3_600_000;
const repoName = (repo: string): string => repo.split("/")[1] ?? repo;
const ref = (i: HealthItem): string => `${repoName(i.repo)}#${i.number}`;
/** En grund som andra väntar på säger hur många. */
const waitedOn = (i: HealthItem): string => {
  const n = i.blocking ?? 0;
  return n > 0 ? ` (${n} väntar på den)` : "";
};
const line = (i: HealthItem, what: string): string => `${ref(i)} ${i.title} — ${what}${waitedOn(i)}`;
const isBlocked = (i: HealthItem): boolean => (i.blockedBy ?? 0) > 0;
const hoursSince = (iso: string | undefined, now: number): number =>
  iso === undefined ? 0 : (now - new Date(iso).getTime()) / HOUR;

function machineOf(flow: Flow, item: HealthItem): Machine | undefined {
  return Object.values(flow.machines).find((m) => m.repo === item.repo && (m.items === "pulls") === item.isPr);
}

/** Sakens tillståndsetiketter (normalt en). */
function currentStates(flow: Flow, item: HealthItem): string[] {
  const machine = machineOf(flow, item);
  return machine ? stateLabels(machine).filter((l) => item.labels.includes(l)) : [];
}

/** Väntar saken på något annat än en agent (en människa, ett beroende, sina arbetsordrar eller nästa release)? */
const waitsOnSomeoneElse = (flow: Flow, item: HealthItem): boolean =>
  item.awaitingRelease === true || item.awaitingWork === true || isBlocked(item) ||
  item.labels.some((l) => flow.nudge.skip_flags.includes(l));

/** Vad som händer med en sak som rör sig. */
function movingText(flow: Flow, i: HealthItem): string {
  if (i.awaitingRelease) return "klar — väntar på nästa release";
  const states = currentStates(flow, i).join(", ");
  if (i.awaitingWork) return `${states} — arbetsordrarna byggs`;
  return isBlocked(i) ? `${states} — väntar på ${i.blockedBy ?? 0} beroende(n)` : states;
}

/** Tillståndet som en agent ska driva vidare för just den här saken (inte en kö), annars undefined. */
function agentState(flow: Flow, item: HealthItem): string | undefined {
  const label = currentStates(flow, item)[0];
  const state = Object.values(machineOf(flow, item)?.states ?? {}).find((s) => s.label === label);
  return state?.agent && !state.queue && !waitsOnSomeoneElse(flow, item) ? label : undefined;
}

function stuckAlarm(flow: Flow, item: HealthItem, now: number): Alarm[] {
  const label = agentState(flow, item);
  if (!label) return [];
  const age = hoursSince(item.labeledAt[label], now);
  if (age * HOUR < parseDuration(flow.health.stuck_after)) return [];
  return [{ key: `stuck:${ref(item)}`, text: line(item, `har stått i ${label} i ${Math.floor(age)} h trots knuffar`) }];
}

type State = Machine["states"][string];

/** Senaste gången något lämnade kön (ISO), bland de öppna sakerna. */
function lastExit(machine: Machine, queue: State, items: readonly HealthItem[]): string | undefined {
  const exits = queue.transitions.flatMap((t) => machine.states[t.to]?.label ?? []);
  return items.flatMap((i) => exits.flatMap((l) => i.labeledAt[l] ?? [])).sort().at(-1);
}

/**
 * En kö (`queue: true`) larmar en gång, när den har saker som väntar men inget
 * har lämnat den på `stuck_after` — inte för varje sak som väntar på sin tur.
 */
function queueAlarm(flow: Flow, machine: Machine, queue: State, snap: HealthSnapshot): Alarm[] {
  const own = snap.items.filter((i) => machineOf(flow, i) === machine);
  const waiting = own.filter((i) => queue.label !== null && i.labels.includes(queue.label) && !waitsOnSomeoneElse(flow, i));
  const last = lastExit(machine, queue, own);
  const idle = last === undefined ? Infinity : hoursSince(last, snap.now);
  if (waiting.length === 0 || idle * HOUR < parseDuration(flow.health.stuck_after)) return [];
  const since = last === undefined ? `på över ${flow.health.stuck_after}` : `på ${Math.floor(idle)} h`;
  return [{
    key: `queue:${repoName(machine.repo)}:${queue.label ?? ""}`,
    text: `Kön i ${queue.label ?? ""} (${repoName(machine.repo)}) står still: inget har lämnat den ${since}, ${waiting.length} väntar. Dygnstaket, eller startar inte ${queue.agent ?? "agenten"}?`,
  }];
}

const queueAlarms = (flow: Flow, snap: HealthSnapshot): Alarm[] =>
  Object.values(flow.machines).flatMap((m) =>
    Object.values(m.states).filter((s) => s.queue).flatMap((s) => queueAlarm(flow, m, s, snap)));

function itemAlarms(flow: Flow, item: HealthItem, now: number): Alarm[] {
  const states = currentStates(flow, item);
  const out: Alarm[] = states.length > 1
    ? [{ key: `multi:${ref(item)}`, text: line(item, `flera tillstånd samtidigt (${states.join(", ")})`) }]
    : [];
  out.push(...stuckAlarm(flow, item, now));
  if (item.isPr && item.mergeState === "clean" && item.labels.includes("granskad") && hoursSince(item.labeledAt.granskad, now) >= 1) {
    out.push({ key: `unmerged:${ref(item)}`, text: line(item, "granskad och grön men inte mergad på över en timme") });
  }
  return out;
}

function waitsForUlrik(item: HealthItem): string | null {
  if (item.labels.includes("blockerad")) return line(item, "blockerad — läs senaste kommentaren och svara");
  if (item.labels.includes("undersökt")) return line(item, "undersökt — sätt verifierad om den ska byggas");
  return null;
}

/** Prioritetsflaggorna i flödets ordning (`prio-hög`, `prio-medel`, `prio-låg`). */
export function prioOrder(flow: Flow): string[] {
  return [...new Set(Object.values(flow.machines).flatMap((m) => Object.keys(m.flags).filter((f) => f.startsWith("prio-"))))];
}

/** Det som väntar på Ulrik, högst prioritet först (utan flagga sist), med prioriteten först på raden. */
function waitingByPrio(items: readonly HealthItem[], order: readonly string[]): string[] {
  const rank = (i: HealthItem): number => {
    const r = order.findIndex((p) => i.labels.includes(p));
    return r === -1 ? order.length : r;
  };
  const tag = (i: HealthItem): string => {
    const p = order[rank(i)];
    return p === undefined ? "" : `[${p.slice("prio-".length)}] `;
  };
  return items
    .flatMap((i) => (waitsForUlrik(i) === null ? [] : [i]))
    .sort((a, b) => rank(a) - rank(b) || a.number - b.number)
    .map((i) => `${tag(i)}${waitsForUlrik(i) ?? ""}`);
}

/** Hela kedjans hälsa. */
export function healthReport(flow: Flow, snap: HealthSnapshot): HealthReport {
  const alarms = [...snap.items.flatMap((i) => itemAlarms(flow, i, snap.now)), ...queueAlarms(flow, snap)];
  if (snap.lastClockRun === null || hoursSince(snap.lastClockRun, snap.now) > 3) {
    alarms.push({ key: "clock", text: "Flödesvaktens klocka har inte gått på över 3 timmar (PR-vakten/verifieringen startar den)." });
  }
  const waitingForUlrik = waitingByPrio(snap.items, prioOrder(flow));
  const moving = snap.items
    .filter((i) => waitsForUlrik(i) === null && currentStates(flow, i).length > 0)
    .map((i) => line(i, movingText(flow, i)));
  return { alarms, waitingForUlrik, moving };
}

const ALARM_MARKER = /<!-- larm: (.*) -->/;

/** Larmnycklarna som stod i förra statussidan. */
export function previousAlarmKeys(body: string): string[] {
  return ALARM_MARKER.exec(body)?.[1]?.split(",").filter((k) => k !== "") ?? [];
}

/** Nya larm sedan förra statussidan — de som ska skickas som push. */
export function newAlarms(report: HealthReport, previousBody: string): Alarm[] {
  const before = new Set(previousAlarmKeys(previousBody));
  return report.alarms.filter((a) => !before.has(a.key));
}

const list = (rows: readonly string[], empty: string): string => (rows.length === 0 ? `_${empty}_` : rows.map((r) => `- ${r}`).join("\n"));

/** Statussidans text. */
export function renderStatus(report: HealthReport, now: number): string {
  return [
    `<!-- larm: ${report.alarms.map((a) => a.key).join(",")} -->`,
    `# Agentkedjans status`,
    "",
    `Uppdaterad ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC av flödesvaktens klocka (varje timme).`,
    "",
    `## ${report.alarms.length === 0 ? "✅ Inga larm" : `⚠️ Larm (${report.alarms.length})`}`,
    list(report.alarms.map((a) => a.text), "Allt rör sig som det ska."),
    "",
    "## Väntar på dig",
    list(report.waitingForUlrik, "Inget."),
    "",
    "## Rör sig",
    list(report.moving, "Inget pågår."),
    "",
  ].join("\n");
}
