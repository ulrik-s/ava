/**
 * Betalningsvillkoret (Ulrik, 2026-11-28; byråns inställning #2265): en faktura
 * förfaller byråns antal dagar efter fakturadagen när ingen förfallodag anges,
 * tio dagar om byrån inte har valt något. Dagarna räknas i svenska
 * kalenderdagar (#1677), så en faktura daterad sent på kvällen får samma
 * förfallodag som en daterad på morgonen.
 */

import { addDays, stockholmDay, stockholmDayStart } from "../stockholm-time";

/** Dagar från fakturadag till förfallodag när byrån inte har valt något. */
export const DEFAULT_PAYMENT_TERM_DAYS = 10;

/** Byråns betalningsvillkor i dagar; utan byrå eller utan val gäller standarden. */
export function paymentTermDaysOf(org: { paymentTermDays?: number | null | undefined } | null): number {
  return org?.paymentTermDays ?? DEFAULT_PAYMENT_TERM_DAYS;
}

/** Förfallodagen för en faktura daterad `invoiceDate`: början av den svenska dagen `days` dagar senare. */
export function defaultDueDate(invoiceDate: Date, days: number = DEFAULT_PAYMENT_TERM_DAYS): Date {
  return stockholmDayStart(addDays(stockholmDay(invoiceDate), days));
}

/** Den angivna förfallodagen, annars fakturadagen plus betalningsvillkoret `days`. */
export function dueDateOr(given: string | undefined | null, invoiceDate: Date, days: number): Date {
  return given ? new Date(given) : defaultDueDate(invoiceDate, days);
}
