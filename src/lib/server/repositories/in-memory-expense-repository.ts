/**
 * In-memory `ExpenseRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `flagBilled` bulk-uppdaterar invoiceId via delegaten.
 */

import type { Expense } from "@/lib/shared/schemas/billing";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  ExpenseListOptions, ExpenseListResult, ExpenseListRow, ExpenseRepository, LawyerReportExpense,
} from "./expense-repository";
import { InMemoryRepository } from "./in-memory-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type ExpenseRepoSource = Pick<IDataStore, "expenses">;

export class InMemoryExpenseRepository extends InMemoryRepository<Expense> implements ExpenseRepository {
  constructor(store: ExpenseRepoSource, now?: () => Date) {
    super(store.expenses, now ?? (() => new Date()));
  }

  async listForOrg(organizationId: string, opts: ExpenseListOptions): Promise<ExpenseListResult> {
    const where = {
      matter: { organizationId },
      ...(opts.matterId ? { matterId: opts.matterId } : {}),
    };
    const [expenses, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          user: { select: { id: true, name: true } },
          matter: { select: { id: true, matterNumber: true, title: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }) as Promise<ExpenseListRow[]>,
      this.delegate.count({ where }),
    ]);
    const agg = await this.delegate.aggregate({ where, _sum: { amount: true } });
    return { expenses, total, totalAmount: (agg as { _sum?: { amount?: number } })._sum?.amount ?? 0 };
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Expense | null> {
    const row = (await this.delegate
      .findFirst({ where: { id, matter: { organizationId } } })) as Expense | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
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

  async listUnfrozenForMatter(matterId: string): Promise<Expense[]> {
    return (await this.delegate.findMany({
      where: { matterId, frozenByBillingRunId: null }, orderBy: { date: "asc" },
    })) as Expense[];
  }

  async freezeForMatter(matterId: string, billingRunId: string, now: Date): Promise<void> {
    await this.delegate.updateMany({
      where: { matterId, frozenByBillingRunId: null },
      data: { frozenAt: now, frozenByBillingRunId: billingRunId } as Partial<Expense>,
    });
  }

  async listForLawyerInPeriod(
    organizationId: string, userId: string, from: Date, to: Date,
  ): Promise<LawyerReportExpense[]> {
    return (await this.delegate.findMany({
      where: { matter: { organizationId }, userId, date: { gte: from, lte: to } },
      include: { matter: { include: { contacts: { where: { role: "KLIENT" }, include: { contact: { select: { name: true } } }, take: 1 } } } },
      orderBy: { date: "asc" },
    })) as LawyerReportExpense[];
  }
}
