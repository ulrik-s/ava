/**
 * `ExpenseRepository` (ADR 0020, #409 fan-out) — utlägg. Bas-CRUD ärvs;
 * `listUnbilled` hämtar valda ofakturerade utlägg, `flagBilled` kopplar dem
 * till fakturan (bulk).
 */

import type { Expense } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

/** Utlägg + listvyns relationer (motsvarar `expense.list`-routerns include). */
export interface ExpenseListRow extends Expense {
  user: { id: string; name: string } | null;
  matter: { id: string; matterNumber: string; title: string } | null;
  invoice: { id: string; invoiceNumber: string | null } | null;
}

/** Filter/paginering för `listForOrg`. */
export interface ExpenseListOptions {
  matterId?: string | undefined;
  page: number;
  pageSize: number;
}

/** Sidresultat: raderna + totalt antal + summa belopp (för listvyns rubrik). */
export interface ExpenseListResult {
  expenses: ExpenseListRow[];
  total: number;
  totalAmount: number;
}

export interface ExpenseRepository extends Repository<Expense> {
  /** Org-scopad, paginerad utläggslista (nyaste först) + total + summa belopp. */
  listForOrg(organizationId: string, opts: ExpenseListOptions): Promise<ExpenseListResult>;
  /** Utlägg by id, org-scopat via ärendet (null om saknas/annan org/raderat). */
  getByIdInOrg(id: string, organizationId: string): Promise<Expense | null>;
  /** Valda ofakturerade utlägg i ett ärende. Tom lista vid tomma ids. */
  listUnbilled(matterId: string, ids: string[]): Promise<Expense[]>;
  /** Koppla utlägg till en faktura (sätter invoiceId). No-op vid tomma ids. */
  flagBilled(ids: string[], invoiceId: string): Promise<void>;
  /** Ofrysta utlägg i ett ärende (date asc) — underlag för billing-run. */
  listUnfrozenForMatter(matterId: string): Promise<Expense[]>;
  /** Frys alla ofrysta utlägg i ett ärende mot en billing-run (bulk). */
  freezeForMatter(matterId: string, billingRunId: string, now: Date): Promise<void>;
}
