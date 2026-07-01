/**
 * In-memory `AccontoDeductionRepository` (ADR 0020) — browser/offline-impl.
 * Endast bas-CRUD (createFinal anropar `create`).
 */

import type { AccontoDeduction } from "@/lib/shared/schemas/billing";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type { AccontoDeductionRepository } from "./acconto-deduction-repository";
import { InMemoryRepository } from "./in-memory-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type AccontoDeductionRepoSource = Pick<IDataStore, "accontoDeductions">;

export class InMemoryAccontoDeductionRepository
  extends InMemoryRepository<AccontoDeduction>
  implements AccontoDeductionRepository {
  constructor(store: AccontoDeductionRepoSource, now?: () => Date) {
    super(store.accontoDeductions, now ?? (() => new Date()));
  }

  async listByFinalInvoice(finalInvoiceId: InvoiceId): Promise<AccontoDeduction[]> {
    return (await this.delegate.findMany({ where: { finalInvoiceId } })) as AccontoDeduction[];
  }
}
