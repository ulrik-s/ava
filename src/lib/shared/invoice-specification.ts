/**
 * Fakturaspecifikationen (#856) — domänmodell + ren summerings-builder.
 *
 * Bröts ut ur `billingRun.ts` (#937) så BÅDE routern och faktura-mallens
 * konsumenter (appen + demo-generatorn) kan bygga/förstå samma shape utan att
 * duplicera aritmetiken. Ren funktion: inga repos, ingen I/O.
 */

import { timeEntryValueOre } from "./billing-work-value";
import { coverageEntryRateOre } from "./brottmalstaxa";
import { chargedExpenseLines } from "./expense-vat";
import { arvodeInclVatOre } from "./invoice-calc";
import type { PaymentMethod, TimeEntryKind } from "./schemas/enums";

/** En rad i fakturans tidsspecifikation (belopp = timmar × gällande timarvode). */
export interface SpecTimeLine {
  date: Date | string; description: string; minutes: number; amountOre: number;
  /** Arvodeskategori (#953) — sammanställningen grupperar och BENÄMNER raderna på
   *  den. Utan kategorin måste benämningen gissas ur timtaxan, vilket ger "Arvode"
   *  även för tidsspillan. Saknas på äldre/carried rader → gissning som förr. */
  kind?: TimeEntryKind | null | undefined;
}
/** En rad i utläggsspecifikationen (netto + brutto, exakt per momssats). */
export interface SpecExpenseLine {
  date: Date | string; description: string; netOre: number; grossOre: number;
  /** Äkta utlägg — vidarefakturerat utan moms (#975). Redovisas som egen grupp. */
  passThrough?: boolean;
}
/** En avdragen (tidigare betald) aconto-faktura. */
export interface SpecDeduction { invoiceNumber: string; date: Date | string | null; amountOre: number }

/**
 * Fakturans fullständiga specifikation (#856): itemiserade tider + utlägg,
 * avdragna aconto-fakturor och summering. `payableOre` = fakturans FAKTISKA
 * belopp; `adjustmentOre` fångar ev. differens (rättshjälps-/rättsskyddssplit,
 * prutning) mellan brutto−avdrag och det som faktureras — visas på en egen rad.
 */
export interface InvoiceSpecification {
  timeLines: SpecTimeLine[];
  expenseLines: SpecExpenseLine[];
  totalMinutes: number;
  arvodeNetOre: number; arvodeVatOre: number;
  expensesNetOre: number; expensesVatOre: number;
  grossOre: number;
  deductions: SpecDeduction[];
  deductionOre: number;
  adjustmentOre: number;
  payableOre: number;
}

export function buildInvoiceSpecification(a: {
  timeLines: SpecTimeLine[]; expenseLines: SpecExpenseLine[]; deductions: SpecDeduction[]; payableOre: number;
}): InvoiceSpecification {
  const arvodeNetOre = a.timeLines.reduce((s, l) => s + l.amountOre, 0);
  const arvodeVatOre = arvodeInclVatOre(arvodeNetOre) - arvodeNetOre;
  const expensesNetOre = a.expenseLines.reduce((s, l) => s + l.netOre, 0);
  const expensesVatOre = a.expenseLines.reduce((s, l) => s + (l.grossOre - l.netOre), 0);
  const deductionOre = a.deductions.reduce((s, d) => s + d.amountOre, 0);
  // Brutto före avdrag. Har fakturan itemiserat arbete → summan av raderna.
  // Saknas rader (t.ex. klientens självrisk-faktura, vars arbete ligger på
  // betalar-fakturan) → härled ur det fakturerade + avdragen, så avdragen kan
  // visas transparent (belopp − aconton = att betala) utan negativ justering.
  const hasLines = a.timeLines.length > 0 || a.expenseLines.length > 0;
  const grossOre = hasLines ? arvodeNetOre + arvodeVatOre + expensesNetOre + expensesVatOre : a.payableOre + deductionOre;
  return {
    timeLines: a.timeLines, expenseLines: a.expenseLines,
    totalMinutes: a.timeLines.reduce((s, l) => s + l.minutes, 0),
    arvodeNetOre, arvodeVatOre, expensesNetOre, expensesVatOre, grossOre,
    deductions: a.deductions, deductionOre,
    adjustmentOre: a.payableOre - (grossOre - deductionOre),
    payableOre: a.payableOre,
  };
}


// ─── Radbyggarna (#1100) ────────────────────────────────────────────────────
//
// Låg i `routers/billingRun.ts` trots att de bygger just de rad-typer som
// deklareras här ovan. Rent: en tidspost värderas, en utläggsrad delas i netto
// och moms. `buildInvoiceSpecification` satt redan här — nu gör dess indata det
// också.

export function specTimeLines(
  method: PaymentMethod,
  entries: ReadonlyArray<{ date: Date | string; description: string; minutes: number; hourlyRate: number; billable: boolean; kind?: TimeEntryKind | null | undefined }>,
  settleDate: Date | string,
): SpecTimeLine[] {
  return entries.filter((t) => t.billable).map((t) => ({
    date: t.date, description: t.description, minutes: t.minutes, kind: t.kind,
    amountOre: timeEntryValueOre(t.minutes, specLineRateOre(method, t, settleDate)),
  }));
}

/**
 * Taxan en spec-rad värderas på (#950). TÄCKNINGSÄRENDEN (rättshjälp/rättsskydd)
 * ersätts enligt Domstolsverkets nivåer, så varje post värderas på SIN KATEGORIS
 * norm för slutregleringsåret — samma regel som slutregleringen, vilket gör att
 * sammanställningens taxerader alltid summerar till fakturabeloppet.
 *
 * PRIVAT/offentligt uppdrag debiterar byråns EGEN taxa, som ligger på posten —
 * en privatklient ska inte faktureras statens norm.
 */
export function specLineRateOre(
  method: PaymentMethod, entry: { hourlyRate: number; kind?: TimeEntryKind | null | undefined }, settleDate: Date | string,
): number {
  const coverage = method === "RATTSHJALP" || method === "RATTSSKYDD";
  return coverage ? coverageEntryRateOre(entry.kind, settleDate) : entry.hourlyRate;
}

export function specExpenseLines(
  expenses: ReadonlyArray<{ date: Date | string; description: string; amount: number; billable: boolean; vatRate?: number | null; vatIncluded?: boolean | null; passThrough?: boolean | null }>,
): SpecExpenseLine[] {
  // Bruttot är det DEBITERADE (25 % enligt NJA 2005 s. 606, #975), inte satsen
  // byrån betalade — annars stämmer inte specifikationen med fakturabeloppet.
  return expenses.filter((e) => e.billable).map((e) => {
    const [line] = chargedExpenseLines([e]);
    const netOre = line?.netOre ?? 0;
    return {
      date: e.date, description: e.description,
      netOre, grossOre: netOre + (line?.vatOre ?? 0),
      passThrough: e.passThrough === true,
    };
  });
}
