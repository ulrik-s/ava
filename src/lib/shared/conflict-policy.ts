/**
 * Konfliktpolicy per entitet (ADR 0017 §3, reviderad efter ADR 0037). Den
 * delade klassningen som styr hur servern löser en inaktuell skrivning.
 * Klassen följer skrivsättet:
 *
 *   - `surface` — procedurägda entiteter (`procedure-owned.ts`, ADR 0037):
 *                 servern kör om proceduren mot aktuellt läge och avvisar en
 *                 ogiltig skrivning, som visas för användaren. Radkön tar inte
 *                 emot deras rader. De står i ingen av listorna nedan och får
 *                 `surface` genom standardvärdet.
 *   - `append`  — radkö-entiteter som bara får läggas till (`appendOnly` i
 *                 `row-push-policy.ts`): idempotent `create` på unikt id.
 *   - `lww`     — radkö-entiteter som får ändras: servern skriver, bumpar
 *                 `version` och svarar kanoniskt.
 *
 * Ren modul (server + klient delar den). En entitet utan klassning är
 * `surface`, det säkraste: avvisar hellre än skriver över tyst (ADR 0017).
 */

export type ConflictClass = "append" | "lww" | "surface";

const APPEND: ReadonlySet<string> = new Set([
  // Jävskontrollens logg kan bara läggas till (radvägens `appendOnly`, #1344).
  "conflictCheck",
]);

const LWW: ReadonlySet<string> = new Set([
  "contact", "task", "calendarEvent", "document", "documentFolder", "documentPart",
  "serviceNote", "userPreference",
]);

export function conflictClassOf(entity: string): ConflictClass {
  if (APPEND.has(entity)) return "append";
  if (LWW.has(entity)) return "lww";
  return "surface";
}
