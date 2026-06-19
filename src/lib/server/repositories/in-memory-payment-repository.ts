/**
 * In-memory `PaymentRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD;
 * `sumByInvoice` läser via delegaten och summerar (samma reduce routern gjorde).
 */

import type { Payment } from "@/lib/shared/schemas/billing";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { PaymentRepository } from "./payment-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type PaymentRepoSource = Pick<IDataStore, "payments">;

export class InMemoryPaymentRepository extends InMemoryRepository<Payment> implements PaymentRepository {
  constructor(private readonly source: PaymentRepoSource, now?: () => Date) {
    super(source.payments, now ?? (() => new Date()));
  }

  async sumByInvoice(invoiceId: string): Promise<number> {
    const rows = await this.source.payments.findMany({ where: { invoiceId } });
    return rows
      .filter((r) => !(r as { deletedAt?: unknown }).deletedAt)
      .reduce((s, p) => s + p.amount, 0);
  }

  async listByInvoiceIds(invoiceIds: string[]): Promise<Payment[]> {
    if (!invoiceIds.length) return [];
    return this.source.payments.findMany({ where: { invoiceId: { in: invoiceIds } } });
  }
}
