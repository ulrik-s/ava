/**
 * `InvoiceDispatchRepository` (ADR 0020, #409 fan-out) — fakturautskick (#178).
 * Org-scopas via faktura→ärende (posten saknar egen organizationId). Bas-CRUD ärvs.
 */

import type { InvoiceDispatch } from "@/lib/shared/schemas/billing";
import type { InvoiceId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Köad utskickspost + fakturans fält som dispatch-workern (#180) behöver. */
export interface InvoiceDispatchQueuedRow extends InvoiceDispatch {
  invoice: {
    id: InvoiceId; invoiceNumber: string | null; amount: number;
    ocrReference: string | null; dueDate: Date | string | null;
  } | null;
}

export interface InvoiceDispatchRepository extends Repository<InvoiceDispatch> {
  /** Alla utskick för en faktura (nyaste först). Org-koll görs av anroparen. */
  listByInvoice(invoiceId: InvoiceId): Promise<InvoiceDispatch[]>;
  /** Alla köade utskick i org:en (äldsta först), med faktura-subset för workern. */
  listQueuedForOrg(organizationId: OrganizationId): Promise<InvoiceDispatchQueuedRow[]>;
}
