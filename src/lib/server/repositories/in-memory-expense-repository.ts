/**
 * In-memory `ExpenseRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `flagBilled` bulk-uppdaterar invoiceId via delegaten.
 */

import type { Expense } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import type { ExpenseRepository } from "./expense-repository";
import { InMemoryRepository } from "./in-memory-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type ExpenseRepoSource = Pick<IDataStore, "expenses">;

export class InMemoryExpenseRepository extends InMemoryRepository<Expense> implements ExpenseRepository {
  constructor(store: ExpenseRepoSource, now?: () => Date) {
    super(store.expenses as unknown as Delegate, now ?? (() => new Date()));
  }

  async listUnbilled(matterId: string, ids: string[]): Promise<Expense[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, matterId, invoiceId: null },
    })) as Expense[];
  }

  async flagBilled(ids: string[], invoiceId: string): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({ where: { id: { in: ids } }, data: { invoiceId } as Partial<Expense> });
  }
}
