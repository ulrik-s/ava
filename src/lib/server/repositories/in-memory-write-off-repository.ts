/**
 * In-memory `WriteOffRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `sumByInvoice` läser via delegaten och summerar.
 */

import type { WriteOff } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { WriteOffRepository } from "./write-off-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type WriteOffRepoSource = Pick<IDataStore, "writeOffs">;

export class InMemoryWriteOffRepository extends InMemoryRepository<WriteOff> implements WriteOffRepository {
  constructor(store: WriteOffRepoSource, now?: () => Date) {
    super(store.writeOffs as unknown as Delegate, now ?? (() => new Date()));
  }

  async sumByInvoice(invoiceId: string): Promise<number> {
    const rows = (await this.delegate.findMany({ where: { invoiceId } })) as ReadonlyArray<WriteOff>;
    return rows
      .filter((r) => !(r as { deletedAt?: unknown }).deletedAt)
      .reduce((s, w) => s + w.amount, 0);
  }
}
