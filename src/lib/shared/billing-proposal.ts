/**
 * Avdragsmedvetet fakturaförslag (#397) — ren formel-modul delad mellan
 * server-routern (`billingRun.proposal`/`createAcconto`) och klient-dialogen
 * (`_billing-dialog`) så samma uträkning aldrig divergerar.
 */

import { matterArvodeNet, matterEntryValueOre, type ValuationMatter } from "./billing-work-value";
import { payableCoverageEntries } from "./brottmalstaxa";
import { arvodeInclVatOre } from "./invoice-calc";
import type { ExpenseKind, TimeEntryKind } from "./schemas/enums";
import { shareOfRow } from "./whole-kronor";

/**
 * Föreslaget aconto-belopp i öre, inkl. moms (#1726):
 *   belopp = (%-sats (bips) × upparbetat värde exkl. moms) + 25 % moms − Σ tidigare aconton.
 * Tidigare aconton sparas brutto, så andelen måste ha momsen på innan avdraget.
 * Klampas till ≥ 0 (ett aconto kan aldrig bli negativt).
 */
export function proposedAccontoOre(
  workValueOre: number,
  clientShareBips: number,
  priorAccontoSumOre: number,
): number {
  // Andelen blir acontofakturans enda rad → hela kronor (#1438) innan momsen.
  return Math.max(0, arvodeInclVatOre(shareOfRow(workValueOre, clientShareBips)) - priorAccontoSumOre);
}


// ─── Det itemiserade förslaget (#1100) ──────────────────────────────────────
//
// `proposedAccontoOre` ovan räknar BELOPPET; `buildProposal` bygger det
// underlag beloppet vilar på. De hörde ihop hela tiden — den ena låg bara i
// routern.

/** En itemiserad rad i fakturaförslaget (#397) — tidspost med beräknat värde. */
export interface ProposalTimeEntry {
  id: string;
  description: string;
  minutes: number;
  hourlyRate: number;
  billable: boolean;
  valueOre: number;
  /** Postens datum (#1888): postlistan visar det och väljer på datumintervall. */
  date: Date | string;
}

/** En itemiserad utläggsrad i fakturaförslaget (#397), med postens datum (#1888). */
export interface ProposalExpense {
  id: string;
  description: string;
  amount: number;
  billable: boolean;
  date: Date | string;
}

/** Avdragsmedvetet fakturaförslag (#397): ofakturerade poster + nyckeltal. */
export interface BillingProposal {
  workValueOre: number;
  priorAccontoSumOre: number;
  timeEntries: ProposalTimeEntry[];
  expenses: ProposalExpense[];
}

/**
 * Bygg ett itemiserat fakturaförslag ur ofrysta tids-/utläggsrader (#397),
 * värderat enligt ärendets betalningssätt (se `matterArvodeNet`). `workValueOre`
 * är arvode netto + debiterbara utlägg. Rättshjälpens rådgivningstimme är en
 * låst (redan fakturerad) post och finns därför inte bland de ofrysta raderna.
 */
export function buildProposal(
  te: ReadonlyArray<{ id: string; description?: string | null; minutes: number; hourlyRate: number; billable: boolean; date: Date | string; kind?: TimeEntryKind | null | undefined }>,
  ex: ReadonlyArray<{ id: string; description?: string | null; amount: number; billable: boolean; date: Date | string; kind?: ExpenseKind }>,
  priorAccontoSumOre: number,
  matter: ValuationMatter,
  date: Date | string = new Date(),
): BillingProposal {
  // § 2-filtret först (#950): en beredskapsdag som förbrukats av helgförhandling
  // ska inte ens synas som fakturerbar rad.
  const payable = payableCoverageEntries(te);
  const timeEntries: ProposalTimeEntry[] = payable.map((t) => ({
    id: t.id, description: t.description ?? "", minutes: t.minutes, hourlyRate: t.hourlyRate,
    billable: t.billable, valueOre: matterEntryValueOre(matter, t, date), date: t.date,
  }));
  const expenses: ProposalExpense[] = ex
    .filter((e) => e.kind !== "PRUTNING")
    .map((e) => ({ id: e.id, description: e.description ?? "", amount: e.amount, billable: e.billable, date: e.date }));
  const workValueOre = matterArvodeNet(matter, { timeEntries: te }, date)
    + expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0);
  return { workValueOre, priorAccontoSumOre, timeEntries, expenses };
}
