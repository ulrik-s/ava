/**
 * Händelsestyrningen: när en sak går in i ett tillstånd startar flödesvakten
 * tillståndets agent direkt, via rutinens API-trigger (`/fire`). Utan token
 * (`ROUTINE_TOKEN_<id>`) gör den inget; rutinens schema tar saken i stället.
 */
import { stateOfLabel } from "./load";
import type { Flow, Machine, Routine } from "./schema";

const FIRE_BETA = "experimental-cc-routine-2026-04-01";

/** Rutinen som ska startas. */
export interface FireTarget { id: string; routine: Routine }

/** Rutinen som ska startas när `label` sätts, eller null. */
export function dispatchTarget(flow: Flow, machine: Machine, label: string): FireTarget | null {
  const stateId = stateOfLabel(machine, label);
  const state = stateId === null ? undefined : machine.states[stateId];
  if (!state?.agent || !state.dispatch) return null;
  const routine = flow.routines[state.agent];
  return routine ? { id: state.agent, routine } : null;
}

/** Tillräckligt av `fetch` för att kunna bytas ut i testerna. */
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/** Startar rutinen. Ger true om den startades. */
export async function fire(target: FireTarget, text: string, token: string | undefined, fetchFn: FetchFn, log: (line: string) => void): Promise<boolean> {
  if (!token) {
    log(`${target.id}: ingen ROUTINE_TOKEN_${target.id} — rutinen tar det vid nästa schemalagda körning`);
    return false;
  }
  const res = await fetchFn(`https://api.anthropic.com/v1/claude_code/routines/${target.routine.trigger_id}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": FIRE_BETA,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  log(`${target.id}: startad (${res.status})`);
  return res.ok;
}
