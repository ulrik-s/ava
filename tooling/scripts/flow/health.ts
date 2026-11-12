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

const ref = (i: HealthItem): string => `${i.repo.split("/")[1] ?? i.repo}#${i.number}`;
const line = (i: HealthItem, what: string): string => `${ref(i)} ${i.title} — ${what}`;
const hoursSince = (iso: string | undefined, now: number): number =>
  iso === undefined ? 0 : (now - new Date(iso).getTime()) / 3_600_000;

function machineOf(flow: Flow, item: HealthItem): Machine | undefined {
  return Object.values(flow.machines).find((m) => m.repo === item.repo && (m.items === "pulls") === item.isPr);
}

/** Sakens tillståndsetiketter (normalt en). */
function currentStates(flow: Flow, item: HealthItem): string[] {
  const machine = machineOf(flow, item);
  return machine ? stateLabels(machine).filter((l) => item.labels.includes(l)) : [];
}

function stuckAlarm(flow: Flow, item: HealthItem, now: number): Alarm[] {
  const label = currentStates(flow, item)[0];
  const state = Object.values(machineOf(flow, item)?.states ?? {}).find((s) => s.label === label);
  if (!label || !state?.agent || item.labels.some((l) => flow.nudge.skip_flags.includes(l))) return [];
  const age = hoursSince(item.labeledAt[label], now);
  if (age * 3_600_000 < parseDuration(flow.health.stuck_after)) return [];
  return [{ key: `stuck:${ref(item)}`, text: line(item, `har stått i ${label} i ${Math.floor(age)} h trots knuffar`) }];
}

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

/** Hela kedjans hälsa. */
export function healthReport(flow: Flow, snap: HealthSnapshot): HealthReport {
  const alarms = snap.items.flatMap((i) => itemAlarms(flow, i, snap.now));
  if (snap.lastClockRun === null || hoursSince(snap.lastClockRun, snap.now) > 3) {
    alarms.push({ key: "clock", text: "Flödesvaktens klocka har inte gått på över 3 timmar (PR-vakten/verifieringen startar den)." });
  }
  const waitingForUlrik = snap.items.flatMap((i) => waitsForUlrik(i) ?? []);
  const moving = snap.items
    .filter((i) => waitsForUlrik(i) === null && currentStates(flow, i).length > 0)
    .map((i) => line(i, currentStates(flow, i).join(", ")));
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
