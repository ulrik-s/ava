/**
 * Drizzle `AccontoDeductionRepository` (ADR 0020) — server-impl. Endast bas-CRUD.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { AccontoDeduction } from "@/lib/shared/schemas/billing";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import { accontoDeductions } from "../db/schema";
import type { AppDb } from "../db/types";
import type { AccontoDeductionRepository } from "./acconto-deduction-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { invoiceOrg } from "./matter-org";

export class DrizzleAccontoDeductionRepository
  extends DrizzleRepository<AccontoDeduction>
  implements AccontoDeductionRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(accontoDeductions), now);
  }

  async listByFinalInvoice(finalInvoiceId: InvoiceId): Promise<AccontoDeduction[]> {
    return await this.db.select().from(accontoDeductions)
      .where(and(eq(accontoDeductions.finalInvoiceId, finalInvoiceId), isNull(accontoDeductions.deletedAt)));
  }

  /** acconto-avdrag saknar org-kolumn → härled via (slut- el. aconto-)fakturan→ärendet (#647). */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    const r = row as { finalInvoiceId?: InvoiceId; accontoInvoiceId?: InvoiceId };
    return invoiceOrg(this.db, r.finalInvoiceId ?? r.accontoInvoiceId);
  }
}
