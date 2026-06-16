/**
 * Drizzle `InvoiceRepository` (ADR 0020, #409 pilot) — server-impl med riktig
 * SQL-pushdown. Centraliserar reconcile-konventionerna app-nivå (ADR 0019):
 * create→version 1, update→version-bump + updatedAt, softDelete→deletedAt.
 *
 * Casterna vid drizzle-gränsen (`as never` på values/set, `as unknown as ...`
 * på resultat) är medvetna: Drizzles rad-typ och zod-typen skiljer sig (version/
 * deletedAt-kolumner, branded id). Strikt zod-parse vid gränsen läggs som delad
 * helper när vi fan-out:ar entiteterna; pilotens korrekthet bevisas av pglite-testerna.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { Invoice, Payment, WriteOff } from "@/lib/shared/schemas/billing";
import { invoices, matters, payments, writeOffs } from "../db/schema";
import type { AppDb } from "../db/types";
import type { InvoiceRepository, InvoiceWithLedger, InvoiceWithRelations } from "./invoice-repository";

export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(
    private readonly db: AppDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getById(id: string): Promise<Invoice | null> {
    const rows = await this.db
      .select().from(invoices)
      .where(and(eq(invoices.id, id), isNull(invoices.deletedAt))).limit(1);
    return (rows[0] as unknown as Invoice | undefined) ?? null;
  }

  async getByIdOrThrow(id: string): Promise<Invoice> {
    const row = await this.getById(id);
    if (!row) throw new Error(`Ingen faktura med id ${id}`);
    return row;
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null> {
    const rows = await this.db
      .select({ inv: invoices }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(invoices.id, id),
        eq(matters.organizationId, organizationId),
        isNull(invoices.deletedAt),
      )).limit(1);
    return (rows[0]?.inv as unknown as Invoice | undefined) ?? null;
  }

  async create(data: Partial<Invoice>): Promise<Invoice> {
    const [row] = await this.db.insert(invoices)
      .values({ ...data, version: 1 } as never).returning();
    return row as unknown as Invoice;
  }

  async update(id: string, patch: Partial<Invoice>): Promise<Invoice> {
    const current = await this.getByIdOrThrow(id);
    const [row] = await this.db.update(invoices)
      .set({ ...patch, version: nextVersion(current), updatedAt: this.now() } as never)
      .where(eq(invoices.id, id)).returning();
    return row as unknown as Invoice;
  }

  async softDelete(id: string): Promise<Invoice> {
    const current = await this.getByIdOrThrow(id);
    const [row] = await this.db.update(invoices)
      .set({ deletedAt: this.now(), version: nextVersion(current) } as never)
      .where(eq(invoices.id, id)).returning();
    return row as unknown as Invoice;
  }

  async getByIdWithRelations(id: string, organizationId: string): Promise<InvoiceWithRelations | null> {
    const row = await this.db.query.invoices.findFirst({
      where: eq(invoices.id, id),
      with: {
        matter: true,
        payments: { with: { recordedBy: true }, orderBy: (p, { desc }) => [desc(p.paidAt)] },
        writeOffs: { orderBy: (w, { desc }) => [desc(w.writtenOffAt)] },
        paymentPlan: { with: { reminders: { orderBy: (r, { desc }) => [desc(r.sentAt)] } } },
        timeEntries: true,
        expenses: true,
        documents: { orderBy: (d, { desc }) => [desc(d.createdAt)] },
      },
    });
    // Org-scope via ärendet + mjuk-delete-filter (db.query saknar relations-where).
    if (!row || row.deletedAt || (row.matter as { organizationId?: string } | null)?.organizationId !== organizationId) {
      return null;
    }
    return row as unknown as InvoiceWithRelations;
  }

  async getByIdWithLedger(id: string): Promise<InvoiceWithLedger | null> {
    const invoice = await this.getById(id);
    if (!invoice) return null;
    const pays = await this.db.select().from(payments).where(eq(payments.invoiceId, id));
    const wos = await this.db.select().from(writeOffs).where(eq(writeOffs.invoiceId, id));
    return { ...invoice, payments: pays as unknown as Payment[], writeOffs: wos as unknown as WriteOff[] };
  }

  async listByMatter(matterId: string): Promise<Invoice[]> {
    const rows = await this.db
      .select().from(invoices)
      .where(and(eq(invoices.matterId, matterId), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.invoiceDate));
    return rows as unknown as Invoice[];
  }
}

function nextVersion(row: Invoice): number {
  return ((row as { version?: number }).version ?? 1) + 1;
}
