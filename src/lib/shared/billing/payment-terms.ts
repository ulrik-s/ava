/**
 * Betalningsvillkoret (Ulrik, 2026-11-28): en faktura förfaller tio dagar efter
 * fakturadagen när ingen förfallodag anges. Dagarna räknas i svenska
 * kalenderdagar (#1677), så en faktura daterad sent på kvällen får samma
 * förfallodag som en daterad på morgonen.
 */

import { addDays, stockholmDay, stockholmDayStart } from "../stockholm-time";

/** Dagar från fakturadag till förfallodag när inget annat anges. */
export const DEFAULT_PAYMENT_TERM_DAYS = 10;

/** Förfallodagen för en faktura daterad `invoiceDate`: början av den svenska dagen tio dagar senare. */
export function defaultDueDate(invoiceDate: Date, days: number = DEFAULT_PAYMENT_TERM_DAYS): Date {
  return stockholmDayStart(addDays(stockholmDay(invoiceDate), days));
}

/** Den angivna förfallodagen, annars fakturadagen plus betalningsvillkoret. */
export function dueDateOr(given: string | undefined | null, invoiceDate: Date): Date {
  return given ? new Date(given) : defaultDueDate(invoiceDate);
}
