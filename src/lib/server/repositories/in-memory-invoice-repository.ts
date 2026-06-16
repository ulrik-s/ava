/**
 * In-memory `InvoiceRepository` (ADR 0020, #409 pilot) — browser/offline-impl.
 * Ärver bas-CRUD från `InMemoryRepository` (som delegerar till LocalStore/query-
 * engine) och lägger relations-läsningarna via store:ns payment/writeOff-delegater.
 */

import type { Invoice } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { InvoiceFull, InvoiceRepository, InvoiceWithLedger, InvoiceWithRelations } from "./invoice-repository";

/** Delegaterna repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type InvoiceRepoSource = Pick<IDataStore, "invoices" | "payments" | "writeOffs">;

export class InMemoryInvoiceRepository extends InMemoryRepository<Invoice> implements InvoiceRepository {
  constructor(private readonly store: InvoiceRepoSource, now?: () => Date) {
    super(store.invoices as unknown as Delegate, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null> {
    // Samma relations-filter som routern använde mot DemoDataStore (org via ärende).
    const row = (await (this.store.invoices as unknown as Delegate)
      .findFirst({ where: { id, matter: { organizationId } } })) as Invoice | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getByIdFull(id: string, organizationId: string): Promise<InvoiceFull | null> {
    // In-memory query-engine resolvar alla relationer (samma include som routern
    // använt) i ETT anrop — inga sekundär-queries behövs (jfr Drizzle-impl:en).
    const row = (await (this.store.invoices as unknown as Delegate).findFirst({
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
    const row = (await (this.store.invoices as unknown as Delegate).findFirst({
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
    const invoice = await this.getById(id);
    if (!invoice) return null;
    const payments = (await (this.store.payments as unknown as Delegate)
      .findMany({ where: { invoiceId: id } })) as InvoiceWithLedger["payments"];
    const writeOffs = (await (this.store.writeOffs as unknown as Delegate)
      .findMany({ where: { invoiceId: id } })) as InvoiceWithLedger["writeOffs"];
    return { ...invoice, payments, writeOffs };
  }

  async listByMatter(matterId: string): Promise<Invoice[]> {
    const rows = (await (this.store.invoices as unknown as Delegate)
      .findMany({ where: { matterId }, orderBy: { invoiceDate: "desc" } })) as Invoice[];
    return rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);
  }
}
