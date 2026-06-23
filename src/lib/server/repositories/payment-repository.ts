/**
 * `PaymentRepository` (ADR 0020, #409 fan-out) — fakturabetalningar. Bas-CRUD
 * ärvs (`create` används av `invoice.recordPayment`); `sumByInvoice` summerar
 * betalt-hinken för fakturans ledger (ersätter den dynamiska `findMany`-reduce).
 */

import type { Payment } from "@/lib/shared/schemas/billing";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

export interface PaymentRepository extends Repository<Payment> {
  /** Summa av alla (icke-raderade) betalningar på en faktura (öre). */
  sumByInvoice(invoiceId: InvoiceId): Promise<number>;
  /** Betalningar för en uppsättning fakturor (rapporter). Tom lista vid tomma ids. */
  listByInvoiceIds(invoiceIds: InvoiceId[]): Promise<Payment[]>;
}
