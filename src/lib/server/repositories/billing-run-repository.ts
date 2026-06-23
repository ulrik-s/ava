/**
 * `BillingRunRepository` (ADR 0020, #409 fan-out) — faktureringshändelser.
 * Bas-CRUD ärvs; läsningarna org-scopas via ärendet (billing-runs saknar egen
 * organizationId). list/byId tar med faktura (+ ärende för detaljvyn); avdrags-
 * /aconto-läsningarna driver fakturaförslaget och FINAL-avdragen.
 */

import type { BillingRun } from "@/lib/shared/schemas/billing";
import type { InvoiceStatus, PaymentMethod } from "@/lib/shared/schemas/enums";
import type { Repository } from "./types";

/** Billing-run + faktura (listvyn). */
export interface BillingRunListRow extends BillingRun {
  invoice: { id: string; invoiceNumber: string | null; status: InvoiceStatus } | null;
}

/** Billing-run + faktura + ärende (detaljvyn). */
export interface BillingRunDetailRow extends BillingRun {
  invoice: { id: string; invoiceNumber: string | null; status: InvoiceStatus; amount: number } | null;
  matter: { id: string; matterNumber: string; title: string; paymentMethod: PaymentMethod | null } | null;
}

export interface BillingRunRepository extends Repository<BillingRun> {
  /** Org:ens billing-runs (createdAt desc), valfritt ärende-filtrerade, med faktura. */
  listForOrg(organizationId: string, matterId?: string): Promise<BillingRunListRow[]>;
  /** En billing-run by id, org-scopad, med faktura + ärende. Null om saknas. */
  getByIdInOrg(id: string, organizationId: string): Promise<BillingRunDetailRow | null>;
  /** Utställda ACCONTO-runs i ett ärende (för Σ tidigare aconto, #397). */
  listAccontoSent(matterId: string): Promise<BillingRun[]>;
  /** ACCONTO-runs i ett ärende med givna id:n (FINAL-avdrag, #60-validering). */
  listAccontoByIds(matterId: string, ids: string[]): Promise<BillingRun[]>;
}
