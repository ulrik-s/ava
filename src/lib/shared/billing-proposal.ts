/**
 * Avdragsmedvetet fakturaförslag (#397) — ren formel-modul delad mellan
 * server-routern (`billingRun.proposal`/`createAcconto`) och klient-dialogen
 * (`_billing-dialog`) så samma uträkning aldrig divergerar.
 */

import { entryOwnValueOre } from "./billing-work-value";
import { payableCoverageEntries } from "./brottmalstaxa";
import type { ExpenseKind, TimeEntryKind } from "./schemas/enums";

/**
 * Föreslaget aconto-belopp i öre:
 *   belopp = %-sats (bips) × upparbetat värde − Σ tidigare aconton.
 * Klampas till ≥ 0 (ett aconto kan aldrig bli negativt).
 */
export function proposedAccontoOre(
  workValueOre: number,
  clientShareBips: number,
  priorAccontoSumOre: number,
): number {
  return Math.max(0, Math.round((workValueOre * clientShareBips) / 10000) - priorAccontoSumOre);
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
}

export interface ProposalExpense {
  id: string;
  description: string;
  amount: number;
  billable: boolean;
}

/** Avdragsmedvetet fakturaförslag (#397): ofakturerade poster + nyckeltal. */
export interface BillingProposal {
  workValueOre: number;
  priorAccontoSumOre: number;
  timeEntries: ProposalTimeEntry[];
  expenses: ProposalExpense[];
}

/** Bygg ett itemiserat fakturaförslag ur ofrysta tids-/utläggsrader (#397). */
export function buildProposal(
  te: ReadonlyArray<{ id: string; description?: string | null; minutes: number; hourlyRate: number; billable: boolean; date: Date | string; kind?: TimeEntryKind | null | undefined }>,
  ex: ReadonlyArray<{ id: string; description?: string | null; amount: number; billable: boolean; kind?: ExpenseKind }>,
  priorAccontoSumOre: number,
): BillingProposal {
  // § 2-filtret först (#950): en beredskapsdag som förbrukats av helgförhandling
  // ska inte ens synas som fakturerbar rad.
  const timeEntries: ProposalTimeEntry[] = payableCoverageEntries(te).map((t) => ({
    id: t.id, description: t.description ?? "", minutes: t.minutes, hourlyRate: t.hourlyRate,
    billable: t.billable, valueOre: entryOwnValueOre(t),
  }));
  const expenses: ProposalExpense[] = ex
    .filter((e) => e.kind !== "PRUTNING")
    .map((e) => ({ id: e.id, description: e.description ?? "", amount: e.amount, billable: e.billable }));
  const workValueOre = timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.valueOre, 0)
    + expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0);
  return { workValueOre, priorAccontoSumOre, timeEntries, expenses };
}
