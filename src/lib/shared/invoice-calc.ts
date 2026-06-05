/**
 * Ren beräkningslogik för fakturor. Inga DB-anrop — gör allt testbart utan
 * mockning och utan att routern behöver duplicera summeringsregler.
 *
 * Alla belopp i öre (Int), så vi slipper flyttalsfel.
 *
 * Datumlogiken nedan använder Temporal (TS6 + @js-temporal/polyfill) för att
 * uttrycka date-only-jämförelser tidszon-säkert och deklarativt i stället för
 * manuell UTC-juggling med Date.
 */

import { Temporal } from "@js-temporal/polyfill";

export interface TimeEntryForInvoice {
  minutes: number;
  hourlyRate: number; // öre per timme
}

export interface ExpenseForInvoice {
  amount: number; // öre
  billable: boolean;
}

export interface AccontoForDeduction {
  id: string;
  amount: number; // öre
}

export interface FinalInvoiceBreakdown {
  /** Brutto: alla debiterbara timmar + utlägg före accontoavdrag. */
  grossAmount: number;
  /** Summan av alla accontoavdrag (positivt tal). */
  accontoDeductionTotal: number;
  /** Nettot som klienten faktiskt ska betala: grossAmount − accontoDeductionTotal. */
  netAmount: number;
  /** Per-rad-avdrag för rendering på fakturan. */
  deductions: Array<{ accontoInvoiceId: string; amount: number }>;
}

/**
 * Räknar ut slutfakturans brutto, avdrag och netto.
 *
 * - `timeEntries.hourlyRate` och `minutes` multipliceras; 60 min i taget
 *   (INT-aritmetik) så 1,5 tim × 1500 kr/h = 2250 kr exakt.
 * - `expenses` räknas bara om `billable=true`.
 * - `accontos` adderas rakt av (beloppet är vad klienten redan betalat).
 *
 * Kastar om netto skulle bli negativt — det betyder att advokaten drar av
 * mer acconto än vad slutfakturan täcker, vilket är ett logikfel i UI:t.
 */
export function computeFinalInvoiceBreakdown(
  timeEntries: readonly TimeEntryForInvoice[],
  expenses: readonly ExpenseForInvoice[],
  accontos: readonly AccontoForDeduction[],
): FinalInvoiceBreakdown {
  const timeTotal = timeEntries.reduce(
    (sum, t) => sum + Math.round((t.minutes * t.hourlyRate) / 60),
    0,
  );
  const expenseTotal = expenses
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + e.amount, 0);
  const grossAmount = timeTotal + expenseTotal;

  const deductions = accontos.map((a) => ({
    accontoInvoiceId: a.id,
    amount: a.amount,
  }));
  const accontoDeductionTotal = deductions.reduce((s, d) => s + d.amount, 0);

  const netAmount = grossAmount - accontoDeductionTotal;
  if (netAmount < 0) {
    throw new Error(
      `Slutfakturan blir negativ: brutto ${grossAmount} öre − acconto ${accontoDeductionTotal} öre = ${netAmount} öre. Justera avdragen.`,
    );
  }

  return { grossAmount, accontoDeductionTotal, netAmount, deductions };
}

/**
 * Avgör om en avbetalningsplan är "färdigbetald" givet summan av registrerade
 * betalningar. När true ska invoice.status → PAID och plan.status → COMPLETED.
 */
export function isPaymentPlanSettled(
  invoiceAmount: number,
  paidSum: number,
): boolean {
  return paidSum >= invoiceAmount;
}

/**
 * Returnerar "YYYY-MM" för ett datum (UTC). Används som stabil nyckel i
 * PaymentPlanReminder för att idempotens-garantera månads-mail.
 */
/** Date → dess UTC-datumdel som Temporal.PlainDate (date-only, ingen tid). */
function toPlainDateUTC(date: Date): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO("UTC")
    .toPlainDate();
}

export function monthKey(date: Date): string {
  return toPlainDateUTC(date).toPlainYearMonth().toString(); // "YYYY-MM"
}

/**
 * Har avbetalningsplanen startat enligt `startDate` vid referensdatumet?
 * Vi jämför datumdelen bara (utan tid) så dev-/prod-tidszon inte spökar.
 */
export function planHasStarted(startDate: Date, today: Date): boolean {
  return Temporal.PlainDate.compare(toPlainDateUTC(today), toPlainDateUTC(startDate)) >= 0;
}
