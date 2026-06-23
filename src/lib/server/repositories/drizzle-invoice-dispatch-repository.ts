/**
 * Drizzle `InvoiceDispatchRepository` (ADR 0020) — server-impl. Org-scopar
 * `listQueuedForOrg` via join faktura→ärende.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { InvoiceDispatch } from "@/lib/shared/schemas/billing";
import type { InvoiceId, OrganizationId } from "@/lib/shared/schemas/ids";
import { invoiceDispatches, invoices, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { InvoiceDispatchQueuedRow, InvoiceDispatchRepository } from "./invoice-dispatch-repository";
import { invoiceOrg } from "./matter-org";

export class DrizzleInvoiceDispatchRepository
  extends DrizzleRepository<InvoiceDispatch>
  implements InvoiceDispatchRepository {
  /** invoice_dispatches saknar org-kolumn → härled via fakturan→ärendet (#647). */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return invoiceOrg(this.db, (row as { invoiceId?: InvoiceId }).invoiceId);
  }

  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(invoiceDispatches), now);
  }

  async listByInvoice(invoiceId: InvoiceId): Promise<InvoiceDispatch[]> {
    const rows = await this.db
      .select().from(invoiceDispatches)
      .where(and(eq(invoiceDispatches.invoiceId, invoiceId), isNull(invoiceDispatches.deletedAt)))
      .orderBy(desc(invoiceDispatches.queuedAt));
    return rows;
  }

  async listQueuedForOrg(organizationId: OrganizationId): Promise<InvoiceDispatchQueuedRow[]> {
    const rows = await this.db
      .select({
        d: invoiceDispatches,
        iId: invoices.id, iNum: invoices.invoiceNumber, iAmount: invoices.amount,
        iOcr: invoices.ocrReference, iDue: invoices.dueDate,
      })
      .from(invoiceDispatches)
      .innerJoin(invoices, eq(invoiceDispatches.invoiceId, invoices.id))
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(invoiceDispatches.status, "queued"),
        eq(matters.organizationId, organizationId),
        isNull(invoiceDispatches.deletedAt),
      ))
      .orderBy(asc(invoiceDispatches.queuedAt));
    return rows.map((r): InvoiceDispatchQueuedRow => ({
      ...r.d,
      invoice: { id: r.iId, invoiceNumber: r.iNum, amount: r.iAmount, ocrReference: r.iOcr, dueDate: r.iDue },
    }));
  }
}
