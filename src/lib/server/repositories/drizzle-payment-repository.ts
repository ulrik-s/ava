/**
 * Drizzle `PaymentRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `sumByInvoice` summerar i SQL (COALESCE(SUM(amount), 0)) bland icke-raderade.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Payment } from "@/lib/shared/schemas/billing";
import { payments } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { PaymentRepository } from "./payment-repository";

export class DrizzlePaymentRepository extends DrizzleRepository<Payment> implements PaymentRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, payments as unknown as VersionedTable, now);
  }

  async sumByInvoice(invoiceId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)` }).from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), isNull(payments.deletedAt)));
    return Number(rows[0]?.total ?? 0);
  }

  async listByInvoiceIds(invoiceIds: string[]): Promise<Payment[]> {
    if (!invoiceIds.length) return [];
    const rows = await this.db
      .select().from(payments)
      .where(and(inArray(payments.invoiceId, invoiceIds), isNull(payments.deletedAt)));
    return rows as unknown as Payment[];
  }
}
