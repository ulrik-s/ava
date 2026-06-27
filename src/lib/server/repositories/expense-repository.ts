/**
 * `ExpenseRepository` (ADR 0020, #409 fan-out) — utlägg. Bas-CRUD ärvs;
 * `listUnbilled` hämtar valda ofakturerade utlägg, `flagBilled` kopplar dem
 * till fakturan (bulk).
 */

import type { Expense } from "@/lib/shared/schemas/billing";
import type { BillingRunId, ExpenseId, InvoiceId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { ReportMatterRef } from "./time-entry-repository";
import type { Repository } from "./types";

/** Utlägg för advokatrapporten — med ärende-ref (KLIENT + betalsätt). */
export interface LawyerReportExpense extends Expense {
  matter: ReportMatterRef | null;
}

/** Utlägg + listvyns relationer (motsvarar `expense.list`-routerns include). */
export interface ExpenseListRow extends Expense {
  user: { id: UserId; name: string } | null;
  matter: { id: MatterId; matterNumber: string; title: string } | null;
  invoice: { id: InvoiceId; invoiceNumber: string | null } | null;
}

/** Filter/paginering för `listForOrg`. */
export interface ExpenseListOptions {
  matterId?: MatterId | undefined;
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
  listForOrg(organizationId: OrganizationId, opts: ExpenseListOptions): Promise<ExpenseListResult>;
  /** Utlägg by id, org-scopat via ärendet (null om saknas/annan org/raderat). */
  getByIdInOrg(id: ExpenseId, organizationId: OrganizationId): Promise<Expense | null>;
  /** Valda ofakturerade utlägg i ett ärende. Tom lista vid tomma ids. */
  listUnbilled(matterId: MatterId, ids: ExpenseId[]): Promise<Expense[]>;
  /** Koppla utlägg till en faktura (sätter invoiceId). No-op vid tomma ids. */
  flagBilled(ids: ExpenseId[], invoiceId: InvoiceId): Promise<void>;
  /** Ofrysta utlägg i ett ärende (date asc) — underlag för billing-run. */
  listUnfrozenForMatter(matterId: MatterId): Promise<Expense[]>;
  /** Utlägg frysta mot en specifik billing-run (date asc) — dom/slutreglering
   *  av en kostnadsräkning vars rader frystes vid inskick. */
  listByBillingRun(billingRunId: BillingRunId): Promise<Expense[]>;
  /** Frys alla ofrysta utlägg i ett ärende mot en billing-run (bulk). */
  freezeForMatter(matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void>;
  /** Frys ENBART de angivna (ofrysta) utläggen mot en billing-run — per-post-val. */
  freezeByIds(ids: ExpenseId[], billingRunId: BillingRunId, now: Date): Promise<void>;
  /** En advokats utlägg i en period (date asc), med ärende-ref (perLawyer-rapporten). */
  listForLawyerInPeriod(organizationId: OrganizationId, userId: UserId, from: Date, to: Date): Promise<LawyerReportExpense[]>;
}
