/**
 * `PaymentPlanReminderRepository` (ADR 0020, #409 fan-out) — loggade
 * avbetalnings-påminnelser. Endast bas-CRUD behövs (`create` loggar en
 * utskickad DUE/OVERDUE-påminnelse); läsningar sker via planens join.
 */

import type { PaymentPlanReminder } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

export type PaymentPlanReminderRepository = Repository<PaymentPlanReminder>;
