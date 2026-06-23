/**
 * In-memory `PaymentPlanRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD från `InMemoryRepository` (delegerar till LocalStore/query-engine);
 * org-scopningen sker via samma relations-where routern använde (`invoice.matter`).
 * Joinade läsningar speglar router-includen (faktura/ärende/KLIENT/betalningar).
 */

import type { PaymentPlan } from "@/lib/shared/schemas/billing";
import type { PaymentPlanStatus } from "@/lib/shared/schemas/enums";
import type { InvoiceId, OrganizationId, PaymentPlanId } from "@/lib/shared/schemas/ids";
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

  async getByIdInOrg(planId: PaymentPlanId, organizationId: OrganizationId): Promise<PaymentPlan | null> {
    const row = (await this.delegate
      .findFirst({ where: { id: planId, invoice: { matter: { organizationId } } } })) as PaymentPlan | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async getByInvoiceId(invoiceId: InvoiceId): Promise<PaymentPlan | null> {
    const row = (await this.delegate.findFirst({ where: { invoiceId } })) as PaymentPlan | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listForOrg(organizationId: OrganizationId, status?: PaymentPlanStatus): Promise<JoinedPaymentPlan[]> {
    return (await this.delegate.findMany({
      where: { ...(status ? { status } : {}), invoice: { matter: { organizationId } } },
      orderBy: { createdAt: "desc" },
      include: { invoice: { include: INVOICE_INCLUDE } },
    })) as JoinedPaymentPlan[];
  }

  async getByIdWithDetails(id: PaymentPlanId, organizationId: OrganizationId): Promise<JoinedPaymentPlanWithReminders | null> {
    const row = (await this.delegate.findFirst({
      where: { id, invoice: { matter: { organizationId } } },
      include: {
        invoice: { include: INVOICE_INCLUDE },
        reminders: { orderBy: { sentAt: "desc" } },
      },
    })) as (JoinedPaymentPlanWithReminders & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }

  async listActiveForScan(organizationId: OrganizationId): Promise<JoinedPaymentPlanWithReminders[]> {
    return (await this.delegate.findMany({
      where: { status: "ACTIVE", invoice: { matter: { organizationId } } },
      include: {
        invoice: { include: SCAN_INVOICE_INCLUDE },
        reminders: true,
      },
    })) as JoinedPaymentPlanWithReminders[];
  }
}
