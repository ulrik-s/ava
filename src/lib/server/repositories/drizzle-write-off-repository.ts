/**
 * Drizzle `WriteOffRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `sumByInvoice` summerar i SQL bland icke-raderade.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { WriteOff } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";
import { writeOffs } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { invoiceOrg } from "./matter-org";
import type { WriteOffRepository } from "./write-off-repository";

export class DrizzleWriteOffRepository extends DrizzleRepository<WriteOff> implements WriteOffRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(writeOffs), now);
  }

  /** write_offs saknar org-kolumn → härled via fakturan→ärendet (#647). */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return invoiceOrg(this.db, (row as { invoiceId?: string }).invoiceId);
  }

  async sumByInvoice(invoiceId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${writeOffs.amount}), 0)` }).from(writeOffs)
      .where(and(eq(writeOffs.invoiceId, asId<"InvoiceId">(invoiceId)), isNull(writeOffs.deletedAt)));
    return Number(rows[0]?.total ?? 0);
  }

  async listByInvoiceIds(invoiceIds: string[]): Promise<WriteOff[]> {
    if (!invoiceIds.length) return [];
    const rows = await this.db
      .select().from(writeOffs)
      .where(and(inArray(writeOffs.invoiceId, invoiceIds.map((id) => asId<"InvoiceId">(id))), isNull(writeOffs.deletedAt)));
    return rows;
  }
}
