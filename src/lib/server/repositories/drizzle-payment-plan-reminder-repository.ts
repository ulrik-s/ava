/**
 * Drizzle `PaymentPlanReminderRepository` (ADR 0020) — server-impl (bas-CRUD).
 */

import type { PaymentPlanReminder } from "@/lib/shared/schemas/billing";
import { paymentPlanReminders } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { PaymentPlanReminderRepository } from "./payment-plan-reminder-repository";

export class DrizzlePaymentPlanReminderRepository
  extends DrizzleRepository<PaymentPlanReminder>
  implements PaymentPlanReminderRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, paymentPlanReminders as unknown as VersionedTable, now);
  }
}
