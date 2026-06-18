/**
 * Drizzle `ExpenseRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `flagBilled` bulk-sätter invoiceId.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Expense } from "@/lib/shared/schemas/billing";
import { expenses, invoices, matters, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  ExpenseListOptions, ExpenseListResult, ExpenseListRow, ExpenseRepository, LawyerReportExpense,
} from "./expense-repository";

export class DrizzleExpenseRepository extends DrizzleRepository<Expense> implements ExpenseRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(expenses), now);
  }

  async listForOrg(organizationId: string, opts: ExpenseListOptions): Promise<ExpenseListResult> {
    const where = and(
      eq(matters.organizationId, organizationId),
      opts.matterId ? eq(expenses.matterId, opts.matterId) : undefined,
    );
    const rows = await this.db
      .select({
        exp: expenses,
        uId: users.id, uName: users.name,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
        invId: invoices.id, invNum: invoices.invoiceNumber,
      })
      .from(expenses)
      .innerJoin(matters, eq(expenses.matterId, matters.id))
      .leftJoin(users, eq(expenses.userId, users.id))
      .leftJoin(invoices, eq(expenses.invoiceId, invoices.id))
      .where(where)
      .orderBy(desc(expenses.date))
      .limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
    const [agg] = await this.db
      .select({ total: sql<number>`count(*)`, sum: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses).innerJoin(matters, eq(expenses.matterId, matters.id)).where(where);
    return {
      expenses: rows.map((r) => ({
        ...(r.exp as object),
        user: r.uId ? { id: r.uId, name: r.uName as string } : null,
        matter: r.mId ? { id: r.mId, matterNumber: r.mNum as string, title: r.mTitle as string } : null,
        invoice: r.invId ? { id: r.invId, invoiceNumber: r.invNum } : null,
      })) as unknown as ExpenseListRow[],
      total: Number(agg?.total ?? 0),
      totalAmount: Number(agg?.sum ?? 0),
    };
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Expense | null> {
    const rows = await this.db
      .select({ exp: expenses }).from(expenses)
      .innerJoin(matters, eq(expenses.matterId, matters.id))
      .where(and(eq(expenses.id, id), eq(matters.organizationId, organizationId), isNull(expenses.deletedAt)))
      .limit(1);
    return (rows[0]?.exp as unknown as Expense | undefined) ?? null;
  }

  async listUnbilled(matterId: string, ids: string[]): Promise<Expense[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select().from(expenses)
      .where(and(inArray(expenses.id, ids), eq(expenses.matterId, matterId), isNull(expenses.invoiceId)));
    return rows as unknown as Expense[];
  }

  async flagBilled(ids: string[], invoiceId: string): Promise<void> {
    if (!ids.length) return;
    await this.db.update(expenses).set({ invoiceId } as never).where(inArray(expenses.id, ids));
  }

  async listUnfrozenForMatter(matterId: string): Promise<Expense[]> {
    const rows = await this.db
      .select().from(expenses)
      .where(and(eq(expenses.matterId, matterId), isNull(expenses.frozenByBillingRunId), isNull(expenses.deletedAt)))
      .orderBy(asc(expenses.date));
    return rows as unknown as Expense[];
  }

  async freezeForMatter(matterId: string, billingRunId: string, now: Date): Promise<void> {
    await this.db.update(expenses)
      .set({ frozenAt: now, frozenByBillingRunId: billingRunId } as never)
      .where(and(eq(expenses.matterId, matterId), isNull(expenses.frozenByBillingRunId)));
  }

  async listForLawyerInPeriod(
    organizationId: string, userId: string, from: Date, to: Date,
  ): Promise<LawyerReportExpense[]> {
    const klient = sql<string | null>`(select c.name from matter_contacts mc join contacts c on mc.contact_id = c.id where mc.matter_id = ${matters.id} and mc.role = 'KLIENT' limit 1)`;
    const rows = await this.db
      .select({
        exp: expenses,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
        mPay: matters.paymentMethod, mNote: matters.paymentMethodNote, mDecided: matters.paymentMethodDecidedAt,
        klient,
      })
      .from(expenses)
      .innerJoin(matters, eq(expenses.matterId, matters.id))
      .where(and(
        eq(matters.organizationId, organizationId), eq(expenses.userId, userId),
        gte(expenses.date, from), lte(expenses.date, to), isNull(expenses.deletedAt),
      ))
      .orderBy(asc(expenses.date));
    return rows.map((r) => ({
      ...(r.exp as object),
      matter: {
        id: r.mId as string, matterNumber: r.mNum as string, title: r.mTitle as string,
        paymentMethod: r.mPay as string, paymentMethodNote: (r.mNote as string | null) ?? null,
        paymentMethodDecidedAt: (r.mDecided as Date | null) ?? null,
        contacts: r.klient ? [{ contact: { name: r.klient as string } }] : [],
      },
    })) as unknown as LawyerReportExpense[];
  }
}
