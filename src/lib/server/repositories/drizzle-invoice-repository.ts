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

import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import type { Invoice, Payment, WriteOff } from "@/lib/shared/schemas/billing";
import { accontoDeductions, invoices, matters, paymentPlans, payments, writeOffs } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import {
  invoiceNumberPrefix, nextInvoiceNumberFrom,
  type InvoiceFull, type InvoiceListFilter, type InvoiceListRow, type InvoiceRepository,
  type InvoiceWithLedger, type InvoiceWithRelations,
} from "./invoice-repository";

export class DrizzleInvoiceRepository extends DrizzleRepository<Invoice> implements InvoiceRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, invoices as unknown as VersionedTable, now);
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

  /** Bar faktura-rad utan org/delete-filter (för self-ref-uppslag). */
  private async rawInvoice(id: string | null | undefined): Promise<Invoice | null> {
    if (!id) return null;
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return (rows[0] as unknown as Invoice | undefined) ?? null;
  }

  async getByIdFull(id: string, organizationId: string): Promise<InvoiceFull | null> {
    const base = await this.getByIdWithRelations(id, organizationId);
    if (!base) return null;
    // Self-ref/dubbel-FK via sekundär-queries (relations() täcker dem inte).
    const deductions = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.finalInvoiceId, id));
    const usages = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.accontoInvoiceId, id));
    const accontoDeductionsFull = await Promise.all(
      deductions.map(async (d) => ({ ...d, accontoInvoice: await this.rawInvoice((d as { accontoInvoiceId: string }).accontoInvoiceId) })),
    );
    const deductedOnFinals = await Promise.all(
      usages.map(async (d) => ({ ...d, finalInvoice: await this.rawInvoice((d as { finalInvoiceId: string }).finalInvoiceId) })),
    );
    const creditedInvoice = await this.rawInvoice((base as { creditedInvoiceId?: string | null }).creditedInvoiceId);
    const creditNoteRows = await this.db.select().from(invoices).where(eq(invoices.creditedInvoiceId, id)).limit(1);
    return {
      ...base,
      accontoDeductions: accontoDeductionsFull,
      deductedOnFinals,
      creditedInvoice,
      creditNote: (creditNoteRows[0] as unknown as Invoice | undefined) ?? null,
    } as unknown as InvoiceFull;
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

  async listForOrg(organizationId: string, filter?: InvoiceListFilter): Promise<InvoiceListRow[]> {
    // Bas-rader: org-scope via inner-join på ärendet + valfria filter (undefined
    // ignoreras av `and`). Relationerna berikas per rad (self-ref → sekundär-queries).
    const baseRows = await this.db
      .select({ inv: invoices, matter: matters }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(matters.organizationId, organizationId),
        isNull(invoices.deletedAt),
        filter?.matterId ? eq(invoices.matterId, filter.matterId) : undefined,
        filter?.invoiceType ? eq(invoices.invoiceType, filter.invoiceType) : undefined,
        filter?.status ? eq(invoices.status, filter.status) : undefined,
      ))
      .orderBy(desc(invoices.invoiceDate));
    return Promise.all(baseRows.map(async ({ inv, matter }) => {
      const id = (inv as { id: string }).id;
      const plan = await this.db.select().from(paymentPlans).where(eq(paymentPlans.invoiceId, id)).limit(1);
      const pays = await this.db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.paidAt));
      const deductions = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.finalInvoiceId, id));
      const accontoDeductionsFull = await Promise.all(
        deductions.map(async (d) => ({ ...d, accontoInvoice: await this.rawInvoice((d as { accontoInvoiceId: string }).accontoInvoiceId) })),
      );
      const usages = await this.db.select({ id: accontoDeductions.id }).from(accontoDeductions).where(eq(accontoDeductions.accontoInvoiceId, id));
      const creditedInvoice = await this.rawInvoice((inv as { creditedInvoiceId?: string | null }).creditedInvoiceId);
      const creditNoteRows = await this.db.select().from(invoices).where(eq(invoices.creditedInvoiceId, id)).limit(1);
      return {
        ...inv,
        matter: { id: (matter as { id: string }).id, matterNumber: (matter as { matterNumber: string }).matterNumber, title: (matter as { title: string }).title },
        paymentPlan: (plan[0] as unknown) ?? null,
        payments: pays as unknown as Payment[],
        accontoDeductions: accontoDeductionsFull,
        deductedOnFinals: usages,
        creditedInvoice: creditedInvoice as InvoiceListRow["creditedInvoice"],
        creditNote: (creditNoteRows[0] as unknown as InvoiceListRow["creditNote"]) ?? null,
      };
    })) as unknown as InvoiceListRow[];
  }

  async nextInvoiceNumber(organizationId: string): Promise<string> {
    const prefix = invoiceNumberPrefix(this.now().getFullYear());
    const rows = await this.db
      .select({ invoiceNumber: invoices.invoiceNumber }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(eq(matters.organizationId, organizationId), like(invoices.invoiceNumber, `${prefix}%`)))
      .orderBy(desc(invoices.invoiceNumber)).limit(1);
    return nextInvoiceNumberFrom(prefix, rows[0]?.invoiceNumber);
  }

  async sumCreditNotesFor(invoiceId: string, organizationId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(abs(${invoices.amount})), 0)` }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(invoices.creditedInvoiceId, invoiceId),
        eq(matters.organizationId, organizationId),
        isNull(invoices.deletedAt),
      ));
    return Number(rows[0]?.total ?? 0);
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
