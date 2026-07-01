/**
 * In-memory `ExpenseRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `flagBilled` bulk-uppdaterar invoiceId via delegaten.
 */

import type { Expense } from "@/lib/shared/schemas/billing";
import type { BillingRunId, ExpenseId, InvoiceId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
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

  async listForOrg(organizationId: OrganizationId, opts: ExpenseListOptions): Promise<ExpenseListResult> {
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

  async getByIdInOrg(id: ExpenseId, organizationId: OrganizationId): Promise<Expense | null> {
    const row = (await this.delegate
      .findFirst({ where: { id, matter: { organizationId } } })) as Expense | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listUnbilled(matterId: MatterId, ids: ExpenseId[]): Promise<Expense[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, matterId, invoiceId: null },
    })) as Expense[];
  }

  async flagBilled(ids: ExpenseId[], invoiceId: InvoiceId): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({ where: { id: { in: ids } }, data: { invoiceId } as Partial<Expense> });
  }

  async listUnfrozenForMatter(matterId: MatterId): Promise<Expense[]> {
    return (await this.delegate.findMany({
      where: { matterId, frozenByBillingRunId: null }, orderBy: { date: "asc" },
    })) as Expense[];
  }

  async listByBillingRun(billingRunId: BillingRunId): Promise<Expense[]> {
    return (await this.delegate.findMany({
      where: { frozenByBillingRunId: billingRunId }, orderBy: { date: "asc" },
    })) as Expense[];
  }

  async listByInvoice(invoiceId: InvoiceId): Promise<Expense[]> {
    return (await this.delegate.findMany({
      where: { invoiceId }, orderBy: { date: "asc" },
    })) as Expense[];
  }

  async freezeForMatter(matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void> {
    await this.delegate.updateMany({
      where: { matterId, frozenByBillingRunId: null },
      data: { frozenAt: now, frozenByBillingRunId: billingRunId } as Partial<Expense>,
    });
  }

  async freezeByIds(ids: ExpenseId[], billingRunId: BillingRunId, now: Date): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({
      where: { id: { in: ids }, frozenByBillingRunId: null },
      data: { frozenAt: now, frozenByBillingRunId: billingRunId } as Partial<Expense>,
    });
  }

  async listForLawyerInPeriod(
    organizationId: OrganizationId, userId: UserId, from: Date, to: Date,
  ): Promise<LawyerReportExpense[]> {
    return (await this.delegate.findMany({
      where: { matter: { organizationId }, userId, date: { gte: from, lte: to } },
      include: { matter: { include: { contacts: { where: { role: "KLIENT" }, include: { contact: { select: { name: true } } }, take: 1 } } } },
      orderBy: { date: "asc" },
    })) as LawyerReportExpense[];
  }
}
