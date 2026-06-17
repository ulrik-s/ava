/**
 * Drizzle `WriteOffRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `sumByInvoice` summerar i SQL bland icke-raderade.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { WriteOff } from "@/lib/shared/schemas/billing";
import { writeOffs } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { WriteOffRepository } from "./write-off-repository";

export class DrizzleWriteOffRepository extends DrizzleRepository<WriteOff> implements WriteOffRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, writeOffs as unknown as VersionedTable, now);
  }

  async sumByInvoice(invoiceId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${writeOffs.amount}), 0)` }).from(writeOffs)
      .where(and(eq(writeOffs.invoiceId, invoiceId), isNull(writeOffs.deletedAt)));
    return Number(rows[0]?.total ?? 0);
  }

  async listByInvoiceIds(invoiceIds: string[]): Promise<WriteOff[]> {
    if (!invoiceIds.length) return [];
    const rows = await this.db
      .select().from(writeOffs)
      .where(and(inArray(writeOffs.invoiceId, invoiceIds), isNull(writeOffs.deletedAt)));
    return rows as unknown as WriteOff[];
  }
}
