/**
 * Acontofakturans nedbrytning (#1940): vad beloppet bygger på. Det upparbetade
 * arbetet (tidsposter och utlägg), klientens andel, avdragen för tidigare
 * acontofakturor och fakturans egen moms, uppställt som slutregleringens
 * klientvy (`settlement-view.ts`) och med samma delade rader.
 *
 * Ren funktion: inga repos, ingen I/O. Importerar bara från `./`, samma gräns
 * som `settlement-view.ts`. Den ändrar inga belopp: fakturans belopp och moms
 * räknas i `createAcconto` som förut, och vyn visar hur de hänger ihop.
 */

import { toIsoDate } from "../iso-date";
import type { PaymentMethod } from "../schemas/enums";
import { accontoSplit } from "./acconto-vat";
import { proposedAccontoOre } from "./billing-proposal";
import {
  expenseNetOre, matterArvodeNet, matterEntryValueOre,
  type UnfrozenWork, type ValuationMatter,
} from "./billing-work-value";
import { specExpenseLines, type SpecDeduction } from "./invoice-specification";
import { vatRow, type SettlementRow } from "./settlement-row";
import {
  accontoDeductionRow, buildClientArvodeLines, toViewLine, workBaseRows,
  type SettlementView, type SettlementViewExpenseLine,
} from "./settlement-view";
import { CURRENT_ROUNDING, roundToKronor, shareOfRow } from "./whole-kronor";

/** Ett utlägg i underlaget, med det som specifikationen visar. */
export type AccontoExpense = UnfrozenWork["expenses"][number] & {
  date: Date | string;
  description: string;
  passThrough?: boolean | null;
};

/** Det ofrysta arbetet acontot räknas på, med utläggens datum och beskrivning. */
export interface AccontoWork {
  timeEntries: UnfrozenWork["timeEntries"];
  expenses: AccontoExpense[];
}

/** Underlaget för acontofakturans nedbrytning. */
export interface AccontoViewInput {
  /** Ärendets betalningssätt styr värderingen och benämningen av andelen. */
  matter: ValuationMatter;
  work: AccontoWork;
  /** Värderingsdagen (samma som `createAcconto` räknar förslaget på). */
  at: Date | string;
  clientShareBips: number;
  /** Fakturans belopp inkl moms, i hela kronor. */
  amountOre: number;
  /** Tidigare acontofakturor i ärendet, de som förslaget drar av. */
  deductions: readonly SpecDeduction[];
}

/** Vad klientens andel heter: avgift i rättshjälp, självrisk i rättsskydd, annars andel. */
export function accontoShareTerm(method: PaymentMethod): string {
  if (method === "RATTSHJALP") return "rättshjälpsavgift";
  if (method === "RATTSSKYDD") return "självrisk";
  return "andel";
}

/** En rad som bara visas när den har ett belopp (med tecken). */
function rowIfNonZero(label: string, amountOre: number): SettlementRow[] {
  return amountOre === 0 ? [] : [{ label, amountOre, kind: "add" }];
}

/** Utläggsraderna i specifikationen, med datumet som kalenderdag (#1938). */
function accontoExpenseLines(expenses: readonly AccontoExpense[]): SettlementViewExpenseLine[] {
  return specExpenseLines(expenses, CURRENT_ROUNDING).map((l) => ({
    date: toIsoDate(l.date), description: l.description, netOre: l.netOre, grossOre: l.grossOre, passThrough: l.passThrough,
  }));
}

/** Beloppen under andelen: avdragen, överskottet, justeringen, momsen och öresavrundningen. */
interface AccontoAmounts {
  excessOre: number;
  adjustmentOre: number;
  vatOre: number;
  roundingOre: number;
}

/**
 * Uträkningen i öre. `baseNet` är andelen minus avdragen, netto. Överskottet
 * visas bara när förslaget blev 0 för att avdragen var större än andelen. En
 * justering finns bara när beloppet skiljer sig från förslaget, och
 * öresavrundningen gör att raderna alltid går jämnt ut på fakturans belopp.
 */
function accontoAmounts(baseNet: number, proposedOre: number, amountOre: number): AccontoAmounts {
  const { netOre, vatOre } = accontoSplit(amountOre);
  const proposedKr = roundToKronor(proposedOre);
  const excessOre = proposedOre === 0 ? Math.max(0, -baseNet) : 0;
  const adjustmentOre = amountOre === proposedKr ? 0 : netOre - accontoSplit(proposedKr).netOre;
  const roundingOre = amountOre - (baseNet + excessOre + adjustmentOre + vatOre);
  return { excessOre, adjustmentOre, vatOre, roundingOre };
}

/**
 * Acontofakturans nedbrytning (#1940): tidsposterna och utläggen i underlaget,
 * och raderna underlag → klientens andel → avdragna aconton → (överskott) →
 * (justering) → moms → (öresavrundning) → att betala. Raderna från andelen och
 * nedåt summerar till fakturans belopp, och momsraden är fakturans moms.
 */
export function buildAccontoView(input: AccontoViewInput): SettlementView {
  const { matter, work, at, clientShareBips, amountOre, deductions } = input;
  const arvodeNet = matterArvodeNet(matter, work, at);
  const expensesNet = expenseNetOre(work);
  const shareNet = shareOfRow(arvodeNet + expensesNet, clientShareBips);
  const deductionRows = deductions.map(accontoDeductionRow);
  const baseNet = shareNet - deductionRows.reduce((s, r) => s + r.amountOre, 0);
  const priorSum = deductions.reduce((s, d) => s + d.amountOre, 0);
  const a = accontoAmounts(baseNet, proposedAccontoOre(arvodeNet + expensesNet, clientShareBips, priorSum), amountOre);
  const netOre = amountOre - a.vatOre;
  const rows: SettlementRow[] = [
    ...workBaseRows(arvodeNet, expensesNet),
    {
      label: `Klientens ${accontoShareTerm(matter.paymentMethod)} (exkl moms)`, amountOre: shareNet, kind: "add",
      basisOre: arvodeNet + expensesNet, shareBips: clientShareBips,
    },
    ...deductionRows,
    ...rowIfNonZero("Tidigare aconton överstiger andelen (exkl moms)", a.excessOre),
    ...rowIfNonZero("Justering (exkl moms)", a.adjustmentOre),
    vatRow(netOre, a.vatOre),
    ...rowIfNonZero("Öresutjämning", a.roundingOre),
  ];
  const valueOf = (t: UnfrozenWork["timeEntries"][number]): number => matterEntryValueOre(matter, t, at);
  return {
    timeLines: buildClientArvodeLines(work, arvodeNet, at, valueOf).map(toViewLine),
    expenseLines: accontoExpenseLines(work.expenses),
    rows, totalLabel: "Att betala (inkl moms)", totalOre: amountOre,
  };
}
