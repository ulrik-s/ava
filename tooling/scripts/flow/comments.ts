/**
 * Svar i kommentarer: vem ska startas när någon svarar? GitHubs händelser för
 * rutiner täcker inte kommentarer, så flödesvakten (en GitHub Action) gör det.
 *
 * - Användarens svar från AVA (`<!-- ava-user-reply:`): agenten som äger
 *   förfrågans tillstånd, eller verifieringen (L1) när tillståndet saknar
 *   agent — den tar "besvarade" förfrågningar också när de är undersökta.
 * - Ulriks egen kommentar (utan app) på något blockerat: tillståndets agent,
 *   som enligt regel 7 läser svaret och låser upp.
 *
 * Agenternas egna kommentarer (via appen) startar aldrig något.
 */
import { stateLabels } from "./load";
import type { Flow, Machine } from "./schema";

export const USER_REPLY_PREFIX = "<!-- ava-user-reply:";

/** En nyskriven kommentar. */
export interface CommentEvent {
  body: string;
  /** Skriven av Ulrik själv (inte via en app). */
  byUlrik: boolean;
  labels: readonly string[];
}

function stateAgent(machine: Machine, labels: readonly string[]): string | null {
  const label = stateLabels(machine).find((l) => labels.includes(l));
  const state = label === undefined
    ? machine.states[machine.start]
    : Object.values(machine.states).find((s) => s.label === label);
  return state?.agent ?? null;
}

/** Rutinen som ska startas för kommentaren, eller null. */
export function commentTarget(flow: Flow, machine: Machine, e: CommentEvent): string | null {
  // Användarsvar finns bara i intaget (privat). I det publika kodrepot kan vem
  // som helst skriva markören, så där räknas bara Ulriks egna kommentarer.
  if (machine === flow.machines.intake && e.body.trimStart().startsWith(USER_REPLY_PREFIX)) {
    return stateAgent(machine, e.labels) ?? (flow.routines.L1 ? "L1" : null);
  }
  if (e.byUlrik && e.labels.includes("blockerad")) return stateAgent(machine, e.labels);
  return null;
}
