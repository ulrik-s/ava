/**
 * In-memory `InvoiceRepository` (ADR 0020, #409 pilot) — browser/offline-impl.
 * Ärver bas-CRUD från `InMemoryRepository` (som delegerar till LocalStore/query-
 * engine) och lägger relations-läsningarna via store:ns payment/writeOff-delegater.
 */

import type { Invoice } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import {
  invoiceNumberPrefix, nextInvoiceNumberFrom,
  type InvoiceFull, type InvoiceListFilter, type InvoiceListRow, type InvoiceRepository,
  type InvoiceWithLedger, type InvoiceWithRelations,
} from "./invoice-repository";

/** Delegaterna repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type InvoiceRepoSource = Pick<IDataStore, "invoices" | "payments" | "writeOffs">;

export class InMemoryInvoiceRepository extends InMemoryRepository<Invoice> implements InvoiceRepository {
  constructor(private readonly store: InvoiceRepoSource, now?: () => Date) {
    super(store.invoices, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null> {
    // Samma relations-filter som routern använde mot DemoDataStore (org via ärende).
    const row = (await this.store.invoices
      .findFirst({ where: { id, matter: { organizationId } } })) as Invoice | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getByIdFull(id: string, organizationId: string): Promise<InvoiceFull | null> {
    // In-memory query-engine resolvar alla relationer (samma include som routern
    // använt) i ETT anrop — inga sekundär-queries behövs (jfr Drizzle-impl:en).
    const row = (await this.store.invoices.findFirst({
      where: { id, matter: { organizationId } },
      include: {
        matter: true,
        payments: { orderBy: { paidAt: "desc" }, include: { recordedBy: { select: { name: true } } } },
        writeOffs: { orderBy: { writtenOffAt: "desc" } },
        paymentPlan: { include: { reminders: { orderBy: { sentAt: "desc" } } } },
        timeEntries: true,
        expenses: true,
        documents: { orderBy: { createdAt: "desc" } },
        accontoDeductions: { include: { accontoInvoice: true } },
        deductedOnFinals: { include: { finalInvoice: true } },
        creditedInvoice: true,
        creditNote: true,
      },
    })) as InvoiceFull | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getByIdWithRelations(id: string, organizationId: string): Promise<InvoiceWithRelations | null> {
    const row = (await this.store.invoices.findFirst({
      where: { id, matter: { organizationId } },
      include: {
        matter: true,
        payments: { orderBy: { paidAt: "desc" }, include: { recordedBy: { select: { name: true } } } },
        writeOffs: { orderBy: { writtenOffAt: "desc" } },
        paymentPlan: { include: { reminders: { orderBy: { sentAt: "desc" } } } },
        timeEntries: true,
        expenses: true,
        documents: { orderBy: { createdAt: "desc" } },
      },
    })) as InvoiceWithRelations | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getByIdWithLedger(id: string): Promise<InvoiceWithLedger | null> {
    const invoice = await this.getById(asId<"InvoiceId">(id));
    if (!invoice) return null;
    const payments = (await this.store.payments
      .findMany({ where: { invoiceId: id } })) as InvoiceWithLedger["payments"];
    const writeOffs = (await this.store.writeOffs
      .findMany({ where: { invoiceId: id } })) as InvoiceWithLedger["writeOffs"];
    return { ...invoice, payments, writeOffs };
  }

  async listForOrg(organizationId: string, filter?: InvoiceListFilter): Promise<InvoiceListRow[]> {
    // Samma where/include som routern använde mot DemoDataStore — query-engine:n
    // resolvar relationerna i ett anrop (jfr Drizzle-impl:ens sekundär-queries).
    const rows = (await this.store.invoices.findMany({
      where: {
        matter: { organizationId },
        ...(filter?.matterId ? { matterId: filter.matterId } : {}),
        ...(filter?.invoiceType ? { invoiceType: filter.invoiceType } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { invoiceDate: "desc" },
      include: {
        matter: { select: { id: true, matterNumber: true, title: true } },
        paymentPlan: true,
        payments: { orderBy: { paidAt: "desc" } },
        accontoDeductions: { include: { accontoInvoice: true } },
        deductedOnFinals: { select: { id: true } },
        creditedInvoice: { select: { id: true, invoiceDate: true, amount: true } },
        creditNote: { select: { id: true, invoiceDate: true, amount: true } },
      },
    })) as InvoiceListRow[];
    return rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);
  }

  async nextInvoiceNumber(organizationId: string): Promise<string> {
    const prefix = invoiceNumberPrefix(this.now().getFullYear());
    const last = (await this.store.invoices.findFirst({
      where: { matter: { organizationId }, invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: "desc" },
    })) as { invoiceNumber?: string | null } | null;
    return nextInvoiceNumberFrom(prefix, last?.invoiceNumber);
  }

  async sumCreditNotesFor(invoiceId: string, organizationId: string): Promise<number> {
    const rows = (await this.store.invoices
      .findMany({ where: { creditedInvoiceId: invoiceId, matter: { organizationId } } })) as ReadonlyArray<Invoice>;
    return rows
      .filter((r) => !(r as { deletedAt?: unknown }).deletedAt)
      .reduce((s, c) => s + Math.abs(c.amount), 0);
  }

  async getCreditNoteFor(invoiceId: string): Promise<Invoice | null> {
    const row = (await this.store.invoices
      .findFirst({ where: { creditedInvoiceId: invoiceId } })) as Invoice | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listDeductibleAccontos(matterId: string, ids: string[]): Promise<Invoice[]> {
    if (!ids.length) return [];
    return (await this.store.invoices.findMany({
      where: { id: { in: ids }, matterId, invoiceType: "ACCONTO", deductedOnFinals: { none: {} } },
    })) as Invoice[];
  }

  async listByMatter(matterId: string): Promise<Invoice[]> {
    const rows = (await this.store.invoices
      .findMany({ where: { matterId }, orderBy: { invoiceDate: "desc" } })) as Invoice[];
    return rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);
  }
}
