/**
 * In-memory `InvoiceDispatchRepository` (ADR 0020) — browser/offline-impl.
 */

import type { InvoiceDispatch } from "@/lib/shared/schemas/billing";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { InvoiceDispatchQueuedRow, InvoiceDispatchRepository } from "./invoice-dispatch-repository";

export type InvoiceDispatchRepoSource = Pick<IDataStore, "invoiceDispatches">;

export class InMemoryInvoiceDispatchRepository
  extends InMemoryRepository<InvoiceDispatch>
  implements InvoiceDispatchRepository {
  constructor(store: InvoiceDispatchRepoSource, now?: () => Date) {
    super(store.invoiceDispatches, now ?? (() => new Date()));
  }

  async listByInvoice(invoiceId: string): Promise<InvoiceDispatch[]> {
    return (await this.delegate.findMany({
      where: { invoiceId },
      orderBy: { queuedAt: "desc" },
    })) as InvoiceDispatch[];
  }

  async listQueuedForOrg(organizationId: string): Promise<InvoiceDispatchQueuedRow[]> {
    return (await this.delegate.findMany({
      where: { status: "queued", invoice: { matter: { organizationId } } },
      include: { invoice: { select: { id: true, invoiceNumber: true, amount: true, ocrReference: true, dueDate: true } } },
      orderBy: { queuedAt: "asc" },
    })) as InvoiceDispatchQueuedRow[];
  }
}
