/**
 * In-memory `WriteOffRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `sumByInvoice` läser via delegaten och summerar.
 */

import type { WriteOff } from "@/lib/shared/schemas/billing";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { WriteOffRepository } from "./write-off-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type WriteOffRepoSource = Pick<IDataStore, "writeOffs">;

export class InMemoryWriteOffRepository extends InMemoryRepository<WriteOff> implements WriteOffRepository {
  constructor(private readonly source: WriteOffRepoSource, now?: () => Date) {
    super(source.writeOffs, now ?? (() => new Date()));
  }

  async sumByInvoice(invoiceId: InvoiceId): Promise<number> {
    const rows = await this.source.writeOffs.findMany({ where: { invoiceId } });
    return rows
      .filter((r) => !(r as { deletedAt?: unknown }).deletedAt)
      .reduce((s, w) => s + w.amount, 0);
  }

  async listByInvoiceIds(invoiceIds: InvoiceId[]): Promise<WriteOff[]> {
    if (!invoiceIds.length) return [];
    return this.source.writeOffs.findMany({ where: { invoiceId: { in: invoiceIds } } });
  }
}
