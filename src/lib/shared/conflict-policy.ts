/**
 * Konfliktpolicy per entitet (ADR 0017, #414) — den delade klassificeringen
 * som styr hur servern löser en stale skrivning vid reconcile:
 *
 *   - `append`  — append-only, ingen konflikt möjlig (idempotent upsert på id).
 *   - `lww`     — sista-skrivning-vinner; servern rebasar och returnerar kanoniskt.
 *   - `surface` — servern validerar invariant/statemaskin mot AKTUELLT tillstånd
 *                 och AVVISAR en stale skrivning → ytläggs för användarbeslut.
 *
 * Ren modul (server + klient delar den). En entitet utan klassning defaultar
 * till `surface` — säkrast: avvisar hellre än överskriver tyst (ADR 0017).
 */

export type ConflictClass = "append" | "lww" | "surface";

const APPEND: ReadonlySet<string> = new Set([
  "timeEntry", "expense", "payment", "paymentPlanReminder", "billingRun",
  "writeOff", "accontoDeduction", "document", "calendarEvent",
]);

const LWW: ReadonlySet<string> = new Set([
  "matter", "contact", "matterContact", "documentFolder", "task",
  "serviceNote", "userPreference", "orgPreference",
]);

export function conflictClassOf(entity: string): ConflictClass {
  if (APPEND.has(entity)) return "append";
  if (LWW.has(entity)) return "lww";
  return "surface";
}
