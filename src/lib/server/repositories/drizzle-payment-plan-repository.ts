/**
 * Drizzle `PaymentPlanRepository` (ADR 0020) — server-impl. Ärver bas-CRUD från
 * `DrizzleRepository`; org-scopningen joinar plan→faktura→ärende (planer saknar
 * egen organizationId), spegling av in-memory-impl:ens relations-where.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { PaymentPlan } from "@/lib/shared/schemas/billing";
import { invoices, matters, paymentPlans } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { PaymentPlanRepository } from "./payment-plan-repository";

export class DrizzlePaymentPlanRepository extends DrizzleRepository<PaymentPlan> implements PaymentPlanRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, paymentPlans as unknown as VersionedTable, now);
  }

  async getByIdInOrg(planId: string, organizationId: string): Promise<PaymentPlan | null> {
    const rows = await this.db
      .select({ plan: paymentPlans }).from(paymentPlans)
      .innerJoin(invoices, eq(paymentPlans.invoiceId, invoices.id))
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(paymentPlans.id, planId),
        eq(matters.organizationId, organizationId),
        isNull(paymentPlans.deletedAt),
      )).limit(1);
    return (rows[0]?.plan as unknown as PaymentPlan | undefined) ?? null;
  }

  async getByInvoiceId(invoiceId: string): Promise<PaymentPlan | null> {
    const rows = await this.db
      .select().from(paymentPlans)
      .where(and(eq(paymentPlans.invoiceId, invoiceId), isNull(paymentPlans.deletedAt))).limit(1);
    return (rows[0] as unknown as PaymentPlan | undefined) ?? null;
  }
}
