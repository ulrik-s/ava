/**
 * Flödesvaktens beslut när en etikett sätts: är det en tillåten övergång,
 * vilka gamla tillståndsetiketter ska bort, och vad gör vi annars.
 * Rena funktioner — GitHub-anropen ligger i `flow-guard.ts`.
 */
import { stateLabels, stateOfLabel } from "./load";
import type { Machine } from "./schema";

/** En etiketthändelse ur GitHubs händelselogg för en issue/PR. */
export interface LabelEvent {
  id: number;
  label: string;
  added: boolean;
  actor: string;
  /** Satt via en GitHub-app (t.ex. Claude) — alltså en agent, inte Ulrik själv. */
  viaApp: boolean;
}

/** Vad vakten ska göra. */
export type Decision =
  | { kind: "ignore" }
  | { kind: "allow"; remove: string[] }
  | { kind: "reject"; reason: string; restore: string | null };

/** Läget när en etikett just satts. */
export interface LabelChange {
  label: string;
  /** Etiketterna saken bär nu (inklusive den nya). */
  current: readonly string[];
  /** Senaste tillståndsetiketten före den här händelsen, eller null. */
  previous: string | null;
  /** Ulrik själv, inte via en app. */
  byUlrik: boolean;
}

/** Var Ulrik själv (inte en agent i hans namn) den som gjorde händelsen? */
export const isUlrik = (e: LabelEvent, ulrik: string): boolean => e.actor === ulrik && !e.viaApp;

/**
 * Tillståndet saken senast gick in i före händelsen `beforeId`: den senast
 * SATTA tillståndsetiketten, oavsett om den tagits bort sedan. Agenterna tar
 * bort det gamla innan de sätter det nya ("ta bort att-granska, sätt
 * granskad"), och en borttagning får inte göra en övergång till ett hopp från
 * start — eller öppna en väg runt en regel ("ta bort undersökt, sätt
 * verifierad"). Inget satt tidigare = starttillståndet (null).
 */
export function previousStateLabel(events: readonly LabelEvent[], beforeId: number, machine: Machine): string | null {
  const states = new Set(stateLabels(machine));
  return events.filter((e) => e.id < beforeId && e.added && states.has(e.label)).at(-1)?.label ?? null;
}

function flagDecision(machine: Machine, change: LabelChange): Decision {
  const flag = machine.flags[change.label];
  if (flag?.by === "ulrik" && !change.byUlrik) {
    return { kind: "reject", reason: `Bara Ulrik själv får sätta \`${change.label}\`.`, restore: null };
  }
  return { kind: "ignore" };
}

function othersToRemove(machine: Machine, change: LabelChange): string[] {
  const states = new Set(stateLabels(machine));
  return change.current.filter((l) => l !== change.label && states.has(l));
}

function transitionProblem(machine: Machine, from: string, to: string, change: LabelChange): string | null {
  const t = machine.states[from]?.transitions.find((x) => x.to === to);
  if (t === undefined) return `Övergången ${from} → ${to} finns inte i flödet.`;
  if (t.by === "ulrik") return `Bara Ulrik själv får flytta ${from} → ${to}.`;
  if (t.unless_flag !== undefined && change.current.includes(t.unless_flag)) {
    return `Med \`${t.unless_flag}\` får bara Ulrik flytta ${from} → ${to}.`;
  }
  return null;
}

const fromState = (machine: Machine, previous: string | null): string =>
  (previous === null ? null : stateOfLabel(machine, previous)) ?? machine.start;

/** Det tidigare tillståndet ska läggas tillbaka om det redan tagits bort. */
const restoreOf = (change: LabelChange): string | null =>
  change.previous !== null && !change.current.includes(change.previous) ? change.previous : null;

/** Beslutet för en satt etikett. Ulrik själv får alltid göra alla övergångar. */
export function decide(machine: Machine, change: LabelChange): Decision {
  const to = stateOfLabel(machine, change.label);
  if (to === null) return flagDecision(machine, change);
  const from = fromState(machine, change.previous);
  const remove = othersToRemove(machine, change);
  const problem = from === to || change.byUlrik ? null : transitionProblem(machine, from, to, change);
  return problem === null ? { kind: "allow", remove } : { kind: "reject", reason: problem, restore: restoreOf(change) };
}

/**
 * Städning av en sak med flera tillståndsetiketter (från före flödesvakten):
 * behåll den som kommit längst, i flow.yaml:s ordning, och ta bort resten.
 */
export function normalizeRemovals(machine: Machine, current: readonly string[]): string[] {
  const present = stateLabels(machine).filter((l) => current.includes(l));
  return present.slice(0, -1);
}
