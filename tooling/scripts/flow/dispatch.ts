/**
 * Händelsestyrningen: när en sak går in i ett tillstånd startar flödesvakten
 * tillståndets agent direkt, via rutinens API-trigger (`/fire`). Utan token
 * (`ROUTINE_TOKEN_<id>`) gör den inget; rutinens schema tar saken i stället.
 */
import type { RepoLabelEvent } from "./github";
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

/** Väntar tillståndet som `label` sätter på att sakens blockerare stängs (`wait_for_blockers`)? */
export function waitsForBlockers(machine: Machine, label: string): boolean {
  const stateId = stateOfLabel(machine, label);
  return stateId !== null && machine.states[stateId]?.wait_for_blockers === true;
}

/**
 * Fönstret där en rutin startas högst `parallel` gånger. Varje etikett startade förr en ny
 * körning, så flera ändringar i följd gav flera samtidiga körningar av samma
 * loop (dubbel nedbrytning, tre granskningar av samma PR, två PR:er för samma
 * issue). Det som kommer under fönstret tar den pågående körningen eller nästa.
 */
export const FIRE_WINDOW_MS = 15 * 60_000;

/** Vad låset frågar om: den här händelsen och rutinen den skulle starta. */
export interface FireQuery {
  /** Den här händelsen; saknas den i loggen (fördröjning) räknas den som nyast. */
  own: Pick<RepoLabelEvent, "number" | "label" | "isPr">;
  routineId: string;
  /** Rutinen en händelse startar (eller null). */
  routineOf: (e: RepoLabelEvent) => string | null;
  now: number;
  windowMs?: number;
  /** Rutinens `parallel`: så många starter får fönstret rymma (standard 1). */
  parallel?: number;
}

/**
 * En TIDIGARE etiketthändelse i fönstret som stänger ute den här: för samma sak,
 * eller den `parallel`:te för samma rutin. Annars null. Händelse-id:n är strikt
 * ordnade, så alla samtidiga vaktjobb ser samma ordning och bara de första
 * startar rutinen — ett lås utan skrivningar.
 */
export function earlierFire(events: readonly RepoLabelEvent[], q: FireQuery): RepoLabelEvent | null {
  const { own } = q;
  const windowMs = q.windowMs ?? FIRE_WINDOW_MS;
  const mine = events.filter((e) => e.number === own.number && e.label === own.label && e.isPr === own.isPr);
  const ownId = mine.length > 0 ? Math.max(...mine.map((e) => e.id)) : Number.POSITIVE_INFINITY;
  const earlier = events.filter((e) => e.id < ownId && q.now - Date.parse(e.at) < windowMs && q.routineOf(e) === q.routineId);
  const same = earlier.find((e) => e.number === own.number && e.isPr === own.isPr);
  return same ?? earlier[(q.parallel ?? 1) - 1] ?? null;
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
