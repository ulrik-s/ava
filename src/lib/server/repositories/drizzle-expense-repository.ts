/**
 * Drizzle `ExpenseRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `flagBilled` bulk-sätter invoiceId.
 *
 * `expenses`-kolumnerna är brandade (#562) → `...r.exp`-spreaden i projektionerna
 * är typad och query-params brandas vid gränsen med `asId` (typad tag, ej dubbel-cast).
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Expense } from "@/lib/shared/schemas/billing";
import { asId, type BillingRunId, type ExpenseId, type InvoiceId, type MatterId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import { expenses, invoices, matters, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  ExpenseListOptions, ExpenseListResult, ExpenseListRow, ExpenseRepository, LawyerReportExpense,
} from "./expense-repository";
import { matterOrg } from "./matter-org";

export class DrizzleExpenseRepository extends DrizzleRepository<Expense> implements ExpenseRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(expenses), now);
  }

  /** expenses saknar org-kolumn → härled via ärendet (#528/#632) så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: MatterId }).matterId);
  }

  async listForOrg(organizationId: OrganizationId, opts: ExpenseListOptions): Promise<ExpenseListResult> {
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
      expenses: rows.map((r): ExpenseListRow => ({
        ...r.exp,
        user: r.uId ? { id: asId<"UserId">(r.uId), name: r.uName ?? "" } : null,
        matter: r.mId ? { id: r.mId, matterNumber: r.mNum ?? "", title: r.mTitle ?? "" } : null,
        invoice: r.invId ? { id: r.invId, invoiceNumber: r.invNum } : null,
      })),
      total: Number(agg?.total ?? 0),
      totalAmount: Number(agg?.sum ?? 0),
    };
  }

  async getByIdInOrg(id: ExpenseId, organizationId: OrganizationId): Promise<Expense | null> {
    const rows = await this.db
      .select({ exp: expenses }).from(expenses)
      .innerJoin(matters, eq(expenses.matterId, matters.id))
      .where(and(eq(expenses.id, id), eq(matters.organizationId, organizationId), isNull(expenses.deletedAt)))
      .limit(1);
    return rows[0]?.exp ?? null;
  }

  async listUnbilled(matterId: MatterId, ids: ExpenseId[]): Promise<Expense[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select().from(expenses)
      .where(and(inArray(expenses.id, ids), eq(expenses.matterId, matterId), isNull(expenses.invoiceId)));
    return rows;
  }

  async flagBilled(ids: ExpenseId[], invoiceId: InvoiceId): Promise<void> {
    if (!ids.length) return;
    await this.db.update(expenses).set({ invoiceId })
      .where(inArray(expenses.id, ids));
  }

  async listUnfrozenForMatter(matterId: MatterId): Promise<Expense[]> {
    const rows = await this.db
      .select().from(expenses)
      .where(and(eq(expenses.matterId, matterId), isNull(expenses.frozenByBillingRunId), isNull(expenses.deletedAt)))
      .orderBy(asc(expenses.date));
    return rows;
  }

  async listByBillingRun(billingRunId: BillingRunId): Promise<Expense[]> {
    return await this.db
      .select().from(expenses)
      .where(and(eq(expenses.frozenByBillingRunId, billingRunId), isNull(expenses.deletedAt)))
      .orderBy(asc(expenses.date));
  }

  async listByInvoice(invoiceId: InvoiceId): Promise<Expense[]> {
    return await this.db
      .select().from(expenses)
      .where(and(eq(expenses.invoiceId, invoiceId), isNull(expenses.deletedAt)))
      .orderBy(asc(expenses.date));
  }

  async freezeForMatter(matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void> {
    await this.db.update(expenses)
      .set({ frozenAt: now, frozenByBillingRunId: billingRunId })
      .where(and(eq(expenses.matterId, matterId), isNull(expenses.frozenByBillingRunId)));
  }

  async freezeByIds(ids: ExpenseId[], billingRunId: BillingRunId, now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(expenses)
      .set({ frozenAt: now, frozenByBillingRunId: billingRunId })
      .where(and(inArray(expenses.id, ids), isNull(expenses.frozenByBillingRunId)));
  }

  async listForLawyerInPeriod(
    organizationId: OrganizationId, userId: UserId, from: Date, to: Date,
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
    return rows.map((r): LawyerReportExpense => ({
      ...r.exp,
      matter: {
        id: r.mId, matterNumber: r.mNum, title: r.mTitle,
        paymentMethod: r.mPay, paymentMethodNote: r.mNote ?? null,
        paymentMethodDecidedAt: r.mDecided ?? null,
        contacts: r.klient ? [{ contact: { name: r.klient } }] : [],
      },
    }));
  }
}
