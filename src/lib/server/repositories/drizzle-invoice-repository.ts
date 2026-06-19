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

import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { Invoice } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";
import { accontoDeductions, invoices, matters, paymentPlans, payments, writeOffs } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import {
  invoiceNumberPrefix, nextInvoiceNumberFrom,
  type InvoiceFull, type InvoiceListFilter, type InvoiceListRow, type InvoiceRepository,
  type InvoiceWithLedger, type InvoiceWithRelations,
} from "./invoice-repository";

export class DrizzleInvoiceRepository extends DrizzleRepository<Invoice> implements InvoiceRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(invoices), now);
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null> {
    const rows = await this.db
      .select({ inv: invoices }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(invoices.id, asId<"InvoiceId">(id)),
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        isNull(invoices.deletedAt),
      )).limit(1);
    return this.asRow(rows[0]?.inv);
  }

  /** Bar faktura-rad utan org/delete-filter (för self-ref-uppslag). */
  private async rawInvoice(id: string | null | undefined): Promise<Invoice | null> {
    if (!id) return null;
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, asId<"InvoiceId">(id))).limit(1);
    return this.asRow(rows[0]);
  }

  async getByIdFull(id: string, organizationId: string): Promise<InvoiceFull | null> {
    const base = await this.getByIdWithRelations(id, organizationId);
    if (!base) return null;
    // Self-ref/dubbel-FK via sekundär-queries (relations() täcker dem inte).
    const deductions = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.finalInvoiceId, asId<"InvoiceId">(id)));
    const usages = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.accontoInvoiceId, asId<"InvoiceId">(id)));
    const accontoDeductionsFull = await Promise.all(
      deductions.map(async (d) => ({ ...d, accontoInvoice: await this.rawInvoice(d.accontoInvoiceId) })),
    );
    const deductedOnFinals = await Promise.all(
      usages.map(async (d) => ({ ...d, finalInvoice: await this.rawInvoice(d.finalInvoiceId) })),
    );
    const creditedInvoice = await this.rawInvoice(base.creditedInvoiceId);
    const creditNoteRows = await this.db.select().from(invoices).where(eq(invoices.creditedInvoiceId, asId<"InvoiceId">(id))).limit(1);
    return {
      ...base,
      accontoDeductions: accontoDeductionsFull,
      deductedOnFinals,
      creditedInvoice,
      creditNote: creditNoteRows[0] ?? null,
    };
  }

  async getByIdWithRelations(id: string, organizationId: string): Promise<InvoiceWithRelations | null> {
    const row = await this.db.query.invoices.findFirst({
      where: eq(invoices.id, asId<"InvoiceId">(id)),
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
    if (!row || row.deletedAt || row.matter?.organizationId !== organizationId) {
      return null;
    }
    return row;
  }

  async listForOrg(organizationId: string, filter?: InvoiceListFilter): Promise<InvoiceListRow[]> {
    // Bas-rader: org-scope via inner-join på ärendet + valfria filter (undefined
    // ignoreras av `and`). Relationerna berikas per rad (self-ref → sekundär-queries).
    const baseRows = await this.db
      .select({ inv: invoices, matter: matters }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        isNull(invoices.deletedAt),
        filter?.matterId ? eq(invoices.matterId, asId<"MatterId">(filter.matterId)) : undefined,
        filter?.invoiceType ? eq(invoices.invoiceType, filter.invoiceType) : undefined,
        filter?.status ? eq(invoices.status, filter.status) : undefined,
      ))
      .orderBy(desc(invoices.invoiceDate));
    return Promise.all(baseRows.map(async ({ inv, matter }): Promise<InvoiceListRow> => {
      const id = inv.id;
      const plan = await this.db.select().from(paymentPlans).where(eq(paymentPlans.invoiceId, asId<"InvoiceId">(id))).limit(1);
      const pays = await this.db.select().from(payments).where(eq(payments.invoiceId, asId<"InvoiceId">(id))).orderBy(desc(payments.paidAt));
      const deductions = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.finalInvoiceId, asId<"InvoiceId">(id)));
      const accontoDeductionsFull = await Promise.all(
        deductions.map(async (d) => ({ ...d, accontoInvoice: await this.rawInvoice(d.accontoInvoiceId) })),
      );
      const usages = await this.db.select({ id: accontoDeductions.id }).from(accontoDeductions).where(eq(accontoDeductions.accontoInvoiceId, asId<"InvoiceId">(id)));
      const creditedInvoice = await this.rawInvoice(inv.creditedInvoiceId);
      const creditNoteRows = await this.db.select().from(invoices).where(eq(invoices.creditedInvoiceId, asId<"InvoiceId">(id))).limit(1);
      return {
        ...inv,
        matter: { id: matter.id, matterNumber: matter.matterNumber, title: matter.title },
        paymentPlan: plan[0] ?? null,
        payments: pays,
        accontoDeductions: accontoDeductionsFull,
        deductedOnFinals: usages,
        creditedInvoice: creditedInvoice ?? null,
        creditNote: creditNoteRows[0] ?? null,
      };
    }));
  }

  async nextInvoiceNumber(organizationId: string): Promise<string> {
    const prefix = invoiceNumberPrefix(this.now().getFullYear());
    const rows = await this.db
      .select({ invoiceNumber: invoices.invoiceNumber }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(eq(matters.organizationId, asId<"OrganizationId">(organizationId)), like(invoices.invoiceNumber, `${prefix}%`)))
      .orderBy(desc(invoices.invoiceNumber)).limit(1);
    return nextInvoiceNumberFrom(prefix, rows[0]?.invoiceNumber);
  }

  async sumCreditNotesFor(invoiceId: string, organizationId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(abs(${invoices.amount})), 0)` }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(invoices.creditedInvoiceId, asId<"InvoiceId">(invoiceId)),
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        isNull(invoices.deletedAt),
      ));
    return Number(rows[0]?.total ?? 0);
  }

  async getCreditNoteFor(invoiceId: string): Promise<Invoice | null> {
    const rows = await this.db
      .select().from(invoices)
      .where(and(eq(invoices.creditedInvoiceId, asId<"InvoiceId">(invoiceId)), isNull(invoices.deletedAt))).limit(1);
    return this.asRow(rows[0]);
  }

  async listDeductibleAccontos(matterId: string, ids: string[]): Promise<Invoice[]> {
    if (!ids.length) return [];
    // ACCONTO i ärendet som ännu inte dragits av: left-join acconto_deductions
    // på accontoInvoiceId + filtrera bort träffar (deductedOnFinals = none).
    const rows = await this.db
      .select({ inv: invoices }).from(invoices)
      .leftJoin(accontoDeductions, eq(accontoDeductions.accontoInvoiceId, invoices.id))
      .where(and(
        inArray(invoices.id, ids.map((i) => asId<"InvoiceId">(i))),
        eq(invoices.matterId, asId<"MatterId">(matterId)),
        eq(invoices.invoiceType, "ACCONTO"),
        isNull(invoices.deletedAt),
        isNull(accontoDeductions.id),
      ));
    return rows.map((r) => r.inv);
  }

  async getByIdWithLedger(id: string): Promise<InvoiceWithLedger | null> {
    const invoice = await this.getById(id);
    if (!invoice) return null;
    const pays = await this.db.select().from(payments).where(eq(payments.invoiceId, asId<"InvoiceId">(id)));
    const wos = await this.db.select().from(writeOffs).where(eq(writeOffs.invoiceId, asId<"InvoiceId">(id)));
    return { ...invoice, payments: pays, writeOffs: wos };
  }

  async listByMatter(matterId: string): Promise<Invoice[]> {
    const rows = await this.db
      .select().from(invoices)
      .where(and(eq(invoices.matterId, asId<"MatterId">(matterId)), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.invoiceDate));
    return this.asRows(rows);
  }
}
