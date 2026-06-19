/**
 * In-memory `PaymentPlanRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD från `InMemoryRepository` (delegerar till LocalStore/query-engine);
 * org-scopningen sker via samma relations-where routern använde (`invoice.matter`).
 * Joinade läsningar speglar router-includen (faktura/ärende/KLIENT/betalningar).
 */

import type { PaymentPlan } from "@/lib/shared/schemas/billing";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type {
  JoinedPaymentPlan, JoinedPaymentPlanWithReminders, PaymentPlanRepository,
} from "./payment-plan-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type PaymentPlanRepoSource = Pick<IDataStore, "paymentPlans">;

/** KLIENT-kontakt (namn) + betalningar + avskrivningar — list/detalj. */
const INVOICE_INCLUDE = {
  matter: {
    include: {
      contacts: { where: { role: "KLIENT" }, include: { contact: { select: { id: true, name: true } } }, take: 1 },
    },
  },
  payments: { orderBy: { paidAt: "desc" } },
  writeOffs: true,
} as const;

/** Scan behöver KLIENT-email (mottagare) + betalningar (utan order). */
const SCAN_INVOICE_INCLUDE = {
  payments: true,
  matter: {
    include: {
      contacts: { where: { role: "KLIENT" }, include: { contact: { select: { id: true, name: true, email: true } } }, take: 1 },
    },
  },
} as const;

export class InMemoryPaymentPlanRepository extends InMemoryRepository<PaymentPlan> implements PaymentPlanRepository {
  constructor(store: PaymentPlanRepoSource, now?: () => Date) {
    super(store.paymentPlans, now ?? (() => new Date()));
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

  async listForOrg(organizationId: string, status?: string): Promise<JoinedPaymentPlan[]> {
    return (await this.delegate.findMany({
      where: { ...(status ? { status } : {}), invoice: { matter: { organizationId } } },
      orderBy: { createdAt: "desc" },
      include: { invoice: { include: INVOICE_INCLUDE } },
    })) as JoinedPaymentPlan[];
  }

  async getByIdWithDetails(id: string, organizationId: string): Promise<JoinedPaymentPlanWithReminders | null> {
    const row = (await this.delegate.findFirst({
      where: { id, invoice: { matter: { organizationId } } },
      include: {
        invoice: { include: INVOICE_INCLUDE },
        reminders: { orderBy: { sentAt: "desc" } },
      },
    })) as (JoinedPaymentPlanWithReminders & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }

  async listActiveForScan(organizationId: string): Promise<JoinedPaymentPlanWithReminders[]> {
    return (await this.delegate.findMany({
      where: { status: "ACTIVE", invoice: { matter: { organizationId } } },
      include: {
        invoice: { include: SCAN_INVOICE_INCLUDE },
        reminders: true,
      },
    })) as JoinedPaymentPlanWithReminders[];
  }
}
