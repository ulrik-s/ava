/**
 * `PaymentPlanRepository` (ADR 0020, #409 fan-out) — avbetalningsplaner.
 * Bas-CRUD ärvs (in-memory: `InMemoryRepository`, server: `DrizzleRepository`);
 * den enda entitets-specifika läsningen är org-scopning via faktura→ärende
 * (planer har ingen egen organizationId).
 */

import type { PaymentPlan } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

export interface PaymentPlanRepository extends Repository<PaymentPlan> {
  /** Plan by id, org-scopad via faktura→ärende (null om saknas/annan org/raderad). */
  getByIdInOrg(planId: string, organizationId: string): Promise<PaymentPlan | null>;
  /** Plan för en faktura (invoiceId är unik på planen) — null om ingen/raderad. */
  getByInvoiceId(invoiceId: string): Promise<PaymentPlan | null>;
}
