/**
 * In-memory `PaymentPlanRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD från `InMemoryRepository` (delegerar till LocalStore/query-engine);
 * org-scopningen sker via samma relations-where routern använde (`invoice.matter`).
 */

import type { PaymentPlan } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { PaymentPlanRepository } from "./payment-plan-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type PaymentPlanRepoSource = Pick<IDataStore, "paymentPlans">;

export class InMemoryPaymentPlanRepository extends InMemoryRepository<PaymentPlan> implements PaymentPlanRepository {
  constructor(store: PaymentPlanRepoSource, now?: () => Date) {
    super(store.paymentPlans as unknown as Delegate, now ?? (() => new Date()));
  }

  async getByIdInOrg(planId: string, organizationId: string): Promise<PaymentPlan | null> {
    const row = (await this.delegate
      .findFirst({ where: { id: planId, invoice: { matter: { organizationId } } } })) as PaymentPlan | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getByInvoiceId(invoiceId: string): Promise<PaymentPlan | null> {
    const row = (await this.delegate.findFirst({ where: { invoiceId } })) as PaymentPlan | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
