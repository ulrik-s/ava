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
import { splitVat } from "./vat";

export interface TimeEntryForInvoice {
  minutes: number;
  hourlyRate: number; // öre per timme
}

export interface ExpenseForInvoice {
  amount: number; // öre (netto om vatIncluded=false, annars brutto)
  billable: boolean;
  /** Moms-sats i bips. Default 25 %. */
  vatRate?: number;
  /** Är `amount` redan inkl moms? Default true (bakåtkompat; netto-rader sätter false). */
  vatIncluded?: boolean;
}

export interface AccontoForDeduction {
  id: string;
  amount: number; // öre
}

/**
 * Moms på arvode i basis points. Alla fakturor lägger på 25 % moms på arvodet
 * oavsett mottagare (#782) — timpriset anges exkl. moms.
 */
export const ARVODE_VAT_BIPS = 2500;

/** Arvode netto (exkl. moms, öre) → inkl. moms (öre). Deterministisk rundning. */
export function arvodeInclVatOre(arvodeNetOre: number): number {
  return arvodeNetOre + Math.round((arvodeNetOre * ARVODE_VAT_BIPS) / 10000);
}

export interface FinalInvoiceBreakdown {
  /** Brutto: arvode inkl. 25 % moms + debiterbara utlägg, före accontoavdrag (#782). */
  grossAmount: number;
  /** Arvodets moms (öre) — del av grossAmount. */
  arvodeVatOre: number;
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
    .reduce((sum, e) => sum + splitVat({ amount: e.amount, vatRate: e.vatRate ?? 2500, vatIncluded: e.vatIncluded ?? true }).inclVat, 0);
  // Arvodet (timmar × timpris) är exkl. moms → lägg på 25 % (#782); utlägg är brutto (inkl moms).
  const arvodeInclVat = arvodeInclVatOre(timeTotal);
  const arvodeVatOre = arvodeInclVat - timeTotal;
  const grossAmount = arvodeInclVat + expenseTotal;

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

  return { grossAmount, arvodeVatOre, accontoDeductionTotal, netAmount, deductions };
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
