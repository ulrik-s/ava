/**
 * Drizzle `InvoiceDispatchRepository` (ADR 0020) — server-impl. Org-scopar
 * `listQueuedForOrg` via join faktura→ärende.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { InvoiceDispatch } from "@/lib/shared/schemas/billing";
import { invoiceDispatches, invoices, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { InvoiceDispatchQueuedRow, InvoiceDispatchRepository } from "./invoice-dispatch-repository";

export class DrizzleInvoiceDispatchRepository
  extends DrizzleRepository<InvoiceDispatch>
  implements InvoiceDispatchRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, invoiceDispatches as unknown as VersionedTable, now);
  }

  async listByInvoice(invoiceId: string): Promise<InvoiceDispatch[]> {
    const rows = await this.db
      .select().from(invoiceDispatches)
      .where(and(eq(invoiceDispatches.invoiceId, invoiceId), isNull(invoiceDispatches.deletedAt)))
      .orderBy(desc(invoiceDispatches.queuedAt));
    return rows as unknown as InvoiceDispatch[];
  }

  async listQueuedForOrg(organizationId: string): Promise<InvoiceDispatchQueuedRow[]> {
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
    return rows.map((r) => ({
      ...(r.d as object),
      invoice: { id: r.iId, invoiceNumber: r.iNum, amount: r.iAmount as number, ocrReference: r.iOcr, dueDate: r.iDue },
    })) as unknown as InvoiceDispatchQueuedRow[];
  }
}
