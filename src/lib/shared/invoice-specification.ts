/**
 * Fakturaspecifikationen (#856) — domänmodell + ren summerings-builder.
 *
 * Bröts ut ur `billingRun.ts` (#937) så BÅDE routern och faktura-mallens
 * konsumenter (appen + demo-generatorn) kan bygga/förstå samma shape utan att
 * duplicera aritmetiken. Ren funktion: inga repos, ingen I/O.
 */

import { arvodeInclVatOre } from "./invoice-calc";
import type { TimeEntryKind } from "./schemas/enums";

/** En rad i fakturans tidsspecifikation (belopp = timmar × gällande timarvode). */
export interface SpecTimeLine {
  date: Date | string; description: string; minutes: number; amountOre: number;
  /** Arvodeskategori (#953) — sammanställningen grupperar och BENÄMNER raderna på
   *  den. Utan kategorin måste benämningen gissas ur timtaxan, vilket ger "Arvode"
   *  även för tidsspillan. Saknas på äldre/carried rader → gissning som förr. */
  kind?: TimeEntryKind | null | undefined;
}
/** En rad i utläggsspecifikationen (netto + brutto, exakt per momssats). */
export interface SpecExpenseLine { date: Date | string; description: string; netOre: number; grossOre: number }
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
