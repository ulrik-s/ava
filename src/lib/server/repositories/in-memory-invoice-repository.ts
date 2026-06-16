/**
 * In-memory `InvoiceRepository` (ADR 0020, #409 pilot) — browser/offline-impl.
 * Ärver bas-CRUD från `InMemoryRepository` (som delegerar till LocalStore/query-
 * engine) och lägger relations-läsningarna via store:ns payment/writeOff-delegater.
 */

import type { Invoice } from "@/lib/shared/schemas/billing";
import type { Delegate } from "../data-store/IDataStore";
import type { LocalStore } from "../data-store/in-memory/local-store";
import { InMemoryRepository } from "./in-memory-repository";
import type { InvoiceRepository, InvoiceWithLedger } from "./invoice-repository";

export class InMemoryInvoiceRepository extends InMemoryRepository<Invoice> implements InvoiceRepository {
  constructor(private readonly store: LocalStore, now?: () => Date) {
    super(store.invoices as unknown as Delegate, now ?? (() => new Date()));
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
