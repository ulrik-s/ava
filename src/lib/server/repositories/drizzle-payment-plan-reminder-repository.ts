/**
 * Drizzle `PaymentPlanReminderRepository` (ADR 0020) — server-impl (bas-CRUD).
 */

import type { PaymentPlanReminder } from "@/lib/shared/schemas/billing";
import { paymentPlanReminders } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { planOrg } from "./matter-org";
import type { PaymentPlanReminderRepository } from "./payment-plan-reminder-repository";

export class DrizzlePaymentPlanReminderRepository
  extends DrizzleRepository<PaymentPlanReminder>
  implements PaymentPlanReminderRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(paymentPlanReminders), now);
  }

  /** påminnelser saknar org-kolumn → härled via planen→fakturan→ärendet (#647). */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return planOrg(this.db, (row as { planId?: string }).planId);
  }
}
