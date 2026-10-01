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

import { and, desc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Invoice } from "@/lib/shared/schemas/billing";
import { asId, type InvoiceId, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { uuidv7 } from "@/lib/shared/uuid";
import { accontoDeductions, invoiceNumbers, invoices, matters, paymentPlans, payments, writeOffs } from "../db/schema";
import type { AppDb } from "../db/types";
import { formatSeriesNumber, seriesPattern } from "../number-series";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import {
  invoiceNumberPrefix,
  type InvoiceFull, type InvoiceListFilter, type InvoiceListRow, type InvoiceRepository,
  type InvoiceWithLedger, type InvoiceWithRelations,
} from "./invoice-repository";
import { matterOrg } from "./matter-org";

/**
 * Högsta löpnumret i serien `prefix` som TAL (#1350). Raderna filtreras med
 * `seriesPattern` först, så bara prefix + siffror castas. Drivrutinen ger
 * bigint som sträng (postgres-js) eller tal/bigint (pglite) — `Number()` vid läsning.
 * `::int` på startpositionen är nödvändig: som otypad parameter tolkas den som
 * text, och `substring(text from text)` är regex-varianten (gav alltid null).
 */
function maxSeq(column: AnyColumn, prefix: string): SQL<string | number | bigint | null> {
  return sql<string | number | bigint | null>`max(substring(${column} from ${prefix.length + 1}::int)::bigint)`;
}

export class DrizzleInvoiceRepository extends DrizzleRepository<Invoice> implements InvoiceRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(invoices), now);
  }

  /** invoices saknar org-kolumn → härled via ärendet (#647) så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: MatterId }).matterId);
  }

  /**
   * Registrera numret och skapa (#1243). Registret skrivs FÖRST: en dubblett
   * inom byrån bryter primärnyckeln innan någon fakturarad finns.
   */
  override async create(data: Partial<Invoice>): Promise<Invoice> {
    const id = data.id ?? asId<"InvoiceId">(uuidv7());
    await this.registerNumber({ id, matterId: data.matterId, invoiceNumber: data.invoiceNumber });
    return super.create({ ...data, id });
  }

  /**
   * Fakturanumret sätts BARA när fakturan skapas, ur serien (#1243, #1350):
   * en uppdatering som bär ett nummer (och OCR:en som härleds ur det) skriver
   * aldrig över det. Förr registrerades ett nummer som kom med en uppdatering
   * av en faktura utan nummer — då kunde ett klientvalt nummer ta en plats i
   * serien. Ingen procedur sätter numret i efterhand.
   */
  override async update(id: InvoiceId, patch: Partial<Invoice>): Promise<Invoice> {
    const { invoiceNumber: _n, ocrReference: _o, ...rest } = patch;
    return super.update(id, rest);
  }

  private async registerNumber(inv: { id: InvoiceId; matterId?: MatterId | undefined; invoiceNumber?: string | null | undefined }): Promise<void> {
    if (!inv.invoiceNumber) return;
    const organizationId = await matterOrg(this.db, inv.matterId);
    if (!organizationId) return;
    await this.db.insert(invoiceNumbers).values({ organizationId, invoiceNumber: inv.invoiceNumber, invoiceId: inv.id });
  }

  async getByIdInOrg(id: InvoiceId, organizationId: OrganizationId): Promise<Invoice | null> {
    const rows = await this.db
      .select({ inv: invoices }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(invoices.id, id),
        eq(matters.organizationId, organizationId),
        isNull(invoices.deletedAt),
      )).limit(1);
    return this.asRow(rows[0]?.inv);
  }

  /** Bar faktura-rad utan org/delete-filter (för self-ref-uppslag). */
  private async rawInvoice(id: InvoiceId | null | undefined): Promise<Invoice | null> {
    if (!id) return null;
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return this.asRow(rows[0]);
  }

  async getByIdFull(id: InvoiceId, organizationId: OrganizationId): Promise<InvoiceFull | null> {
    const base = await this.getByIdWithRelations(id, organizationId);
    if (!base) return null;
    // Self-ref/dubbel-FK via sekundär-queries (relations() täcker dem inte).
    const deductions = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.finalInvoiceId, id));
    const usages = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.accontoInvoiceId, id));
    const accontoDeductionsFull = await Promise.all(
      deductions.map(async (d) => ({ ...d, accontoInvoice: await this.rawInvoice(d.accontoInvoiceId) })),
    );
    const deductedOnFinals = await Promise.all(
      usages.map(async (d) => ({ ...d, finalInvoice: await this.rawInvoice(d.finalInvoiceId) })),
    );
    const creditedInvoice = await this.rawInvoice(base.creditedInvoiceId);
    const creditNoteRows = await this.db.select().from(invoices).where(eq(invoices.creditedInvoiceId, id)).limit(1);
    return {
      ...base,
      accontoDeductions: accontoDeductionsFull,
      deductedOnFinals,
      creditedInvoice,
      creditNote: creditNoteRows[0] ?? null,
    };
  }

  async getByIdWithRelations(id: InvoiceId, organizationId: OrganizationId): Promise<InvoiceWithRelations | null> {
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
    if (!row || row.deletedAt || row.matter?.organizationId !== organizationId) {
      return null;
    }
    return row;
  }

  async listForOrg(organizationId: OrganizationId, filter?: InvoiceListFilter): Promise<InvoiceListRow[]> {
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
    return Promise.all(baseRows.map(async ({ inv, matter }): Promise<InvoiceListRow> => {
      const id = inv.id;
      const plan = await this.db.select().from(paymentPlans).where(eq(paymentPlans.invoiceId, id)).limit(1);
      const pays = await this.db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.paidAt));
      const deductions = await this.db.select().from(accontoDeductions).where(eq(accontoDeductions.finalInvoiceId, id));
      const accontoDeductionsFull = await Promise.all(
        deductions.map(async (d) => ({ ...d, accontoInvoice: await this.rawInvoice(d.accontoInvoiceId) })),
      );
      const usages = await this.db.select({ id: accontoDeductions.id }).from(accontoDeductions).where(eq(accontoDeductions.accontoInvoiceId, id));
      const creditedInvoice = await this.rawInvoice(inv.creditedInvoiceId);
      const creditNoteRows = await this.db.select().from(invoices).where(eq(invoices.creditedInvoiceId, id)).limit(1);
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

  async nextInvoiceNumber(organizationId: OrganizationId, year: number = stockholmYear(this.now())): Promise<string> {
    const prefix = invoiceNumberPrefix(year);
    // Ett nummer i taget per byrå (#1243): låset hålls till transaktionens slut,
    // så två samtidiga faktureringar inte läser samma "senaste" nummer.
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-number:${organizationId}`}))`);
    // Både fakturorna och registret: ett nummer som registrerats men vars
    // fakturarad aldrig skrevs (avbrott utanför transaktion) återanvänds inte.
    // Högsta löpnumret NUMERISKT (#1350) — textuellt är 9999 > 10000.
    const pattern = seriesPattern(prefix);
    const [fromInvoices] = await this.db
      .select({ seq: maxSeq(invoices.invoiceNumber, prefix) }).from(invoices)
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(eq(matters.organizationId, organizationId), sql`${invoices.invoiceNumber} ~ ${pattern}`));
    const [fromRegister] = await this.db
      .select({ seq: maxSeq(invoiceNumbers.invoiceNumber, prefix) }).from(invoiceNumbers)
      .where(and(eq(invoiceNumbers.organizationId, organizationId), sql`${invoiceNumbers.invoiceNumber} ~ ${pattern}`));
    return formatSeriesNumber(prefix, Math.max(Number(fromInvoices?.seq ?? 0), Number(fromRegister?.seq ?? 0)) + 1);
  }

  async sumCreditNotesFor(invoiceId: InvoiceId, organizationId: OrganizationId): Promise<number> {
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

  async getCreditNoteFor(invoiceId: InvoiceId): Promise<Invoice | null> {
    const rows = await this.db
      .select().from(invoices)
      .where(and(eq(invoices.creditedInvoiceId, invoiceId), isNull(invoices.deletedAt))).limit(1);
    return this.asRow(rows[0]);
  }

  async listDeductibleAccontos(matterId: MatterId, ids: InvoiceId[]): Promise<Invoice[]> {
    if (!ids.length) return [];
    // ACCONTO i ärendet som ännu inte dragits av: left-join acconto_deductions
    // på accontoInvoiceId + filtrera bort träffar (deductedOnFinals = none).
    const rows = await this.db
      .select({ inv: invoices }).from(invoices)
      .leftJoin(accontoDeductions, eq(accontoDeductions.accontoInvoiceId, invoices.id))
      .where(and(
        inArray(invoices.id, ids),
        eq(invoices.matterId, matterId),
        eq(invoices.invoiceType, "ACCONTO"),
        isNull(invoices.deletedAt),
        isNull(accontoDeductions.id),
      ));
    return rows.map((r) => r.inv);
  }

  async getByIdWithLedger(id: InvoiceId): Promise<InvoiceWithLedger | null> {
    const invoice = await this.getById(id);
    if (!invoice) return null;
    const pays = await this.db.select().from(payments).where(eq(payments.invoiceId, id));
    const wos = await this.db.select().from(writeOffs).where(eq(writeOffs.invoiceId, id));
    return { ...invoice, payments: pays, writeOffs: wos };
  }

  async listByMatter(matterId: MatterId): Promise<Invoice[]> {
    const rows = await this.db
      .select().from(invoices)
      .where(and(eq(invoices.matterId, matterId), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.invoiceDate));
    return this.asRows(rows);
  }
}
