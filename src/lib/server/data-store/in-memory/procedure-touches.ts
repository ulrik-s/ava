/**
 * Raderna ett köat procedur-anrop rör (`touches`, #1265, ADR 0037): formen,
 * gränsen och fångsten. Servern läser tillbaka varje rörd rad efter
 * omkörningen och skickar dess kanoniska läge till klienten.
 */
import { z } from "zod";
import type { MutationEvent } from "./writable-delegate";

/** En utpekad rad (entitet + id): ett procedur-anrops `touches` och `sync.rows`. */
export const rowRefSchema = z.object({ entity: z.string().max(100), id: z.string().max(100) });

/** En rad som ett köat procedur-anrop skrev lokalt. */
export type ProcedureTouch = z.infer<typeof rowRefSchema>;

/**
 * Högst så här många rader får ett köat procedur-anrop röra (#1674). Gränsen
 * var 100 (som `sync.rows`) och servern avvisade då t.ex. en debitering av ett
 * ärende med fler än 100 tidsposter. Klientens kö och serverns omkörning läser
 * samma värde.
 */
export const MAX_PROCEDURE_TOUCHES = 10_000;

/**
 * Lägg till en berörd rad (en gång per rad) i ett procedur-anrops fångst.
 * Kastar när anropet rör fler rader än servern tar emot. Fångsten sker när
 * transaktionen flushar, inne i dess try, så kastet rullar tillbaka anropet
 * lokalt och inget köas.
 */
export function recordTouch(touches: ProcedureTouch[], event: MutationEvent<Record<string, unknown>>): void {
  const id = typeof event.row.id === "string" ? event.row.id : "";
  if (!touches.some((t) => t.entity === event.entity && t.id === id)) touches.push({ entity: event.entity, id });
  if (touches.length > MAX_PROCEDURE_TOUCHES) {
    throw new Error(`Ändringen rör ${touches.length} rader; högst ${MAX_PROCEDURE_TOUCHES} kan sparas i ett anrop.`);
  }
}
