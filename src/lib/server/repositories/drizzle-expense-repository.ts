/**
 * Drizzle `ExpenseRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `flagBilled` bulk-sätter invoiceId.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Expense } from "@/lib/shared/schemas/billing";
import { expenses } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { ExpenseRepository } from "./expense-repository";

export class DrizzleExpenseRepository extends DrizzleRepository<Expense> implements ExpenseRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, expenses as unknown as VersionedTable, now);
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
}
