/**
 * In-memory `PaymentPlanReminderRepository` (ADR 0020) — browser/offline-impl.
 */

import type { PaymentPlanReminder } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { PaymentPlanReminderRepository } from "./payment-plan-reminder-repository";

export type PaymentPlanReminderRepoSource = Pick<IDataStore, "paymentPlanReminders">;

export class InMemoryPaymentPlanReminderRepository
  extends InMemoryRepository<PaymentPlanReminder>
  implements PaymentPlanReminderRepository {
  constructor(store: PaymentPlanReminderRepoSource, now?: () => Date) {
    super(store.paymentPlanReminders as unknown as Delegate, now ?? (() => new Date()));
  }
}
