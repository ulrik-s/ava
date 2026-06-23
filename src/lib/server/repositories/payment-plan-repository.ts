/**
 * `PaymentPlanRepository` (ADR 0020, #409 fan-out) — avbetalningsplaner.
 * Bas-CRUD ärvs (in-memory: `InMemoryRepository`, server: `DrizzleRepository`);
 * org-scopning sker via faktura→ärende (planer har ingen egen organizationId).
 *
 * Läsmetoderna returnerar den joinade plan-formen som list-/detalj-vyn och
 * påminnelse-skannern (`computeDueReminders`) konsumerar: faktura + ärende
 * (inkl. KLIENT-kontakt) + betalningar + avskrivningar (+ påminnelser).
 */

import type { Invoice, Payment, PaymentPlan, PaymentPlanReminder, WriteOff } from "@/lib/shared/schemas/billing";
import type { PaymentPlanStatus } from "@/lib/shared/schemas/enums";
import type { ContactId, InvoiceId, OrganizationId, PaymentPlanId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

/** Ärende + KLIENT-kontakten (namn/email för påminnelse-mottagaren). */
export interface PlanMatter extends Matter {
  contacts: Array<{ contact: { id: ContactId; name: string; email?: string | null } }>;
}

/** Faktura med ledger-rader + ärende (det list-/scan-vyn räknar på). */
export interface PlanInvoice extends Invoice {
  matter: PlanMatter | null;
  payments: Payment[];
  writeOffs: WriteOff[];
}

/** Joinad plan (list). */
export interface JoinedPaymentPlan extends PaymentPlan {
  invoice: PlanInvoice | null;
}

/** Joinad plan + påminnelse-historik (detalj + scan). */
export interface JoinedPaymentPlanWithReminders extends JoinedPaymentPlan {
  reminders: PaymentPlanReminder[];
}

export interface PaymentPlanRepository extends Repository<PaymentPlan> {
  /** Plan by id, org-scopad via faktura→ärende (null om saknas/annan org/raderad). */
  getByIdInOrg(planId: PaymentPlanId, organizationId: OrganizationId): Promise<PaymentPlan | null>;
  /** Plan för en faktura (invoiceId är unik på planen) — null om ingen/raderad. */
  getByInvoiceId(invoiceId: InvoiceId): Promise<PaymentPlan | null>;
  /** Org:ens planer (createdAt desc), valfritt status-filtrerade, joinade. */
  listForOrg(organizationId: OrganizationId, status?: PaymentPlanStatus): Promise<JoinedPaymentPlan[]>;
  /** En plan med full join + påminnelse-historik, org-scopad. Null om saknas. */
  getByIdWithDetails(id: PaymentPlanId, organizationId: OrganizationId): Promise<JoinedPaymentPlanWithReminders | null>;
  /** Aktiva planer i org:en (join + påminnelser) för påminnelse-skannern. */
  listActiveForScan(organizationId: OrganizationId): Promise<JoinedPaymentPlanWithReminders[]>;
}
