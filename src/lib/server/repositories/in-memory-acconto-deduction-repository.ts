/**
 * In-memory `AccontoDeductionRepository` (ADR 0020) — browser/offline-impl.
 * Endast bas-CRUD (createFinal anropar `create`).
 */

import type { AccontoDeduction } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import type { AccontoDeductionRepository } from "./acconto-deduction-repository";
import { InMemoryRepository } from "./in-memory-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type AccontoDeductionRepoSource = Pick<IDataStore, "accontoDeductions">;

export class InMemoryAccontoDeductionRepository
  extends InMemoryRepository<AccontoDeduction>
  implements AccontoDeductionRepository {
  constructor(store: AccontoDeductionRepoSource, now?: () => Date) {
    super(store.accontoDeductions as unknown as Delegate, now ?? (() => new Date()));
  }
}
