/**
 * `Repositories` (ADR 0020) — aggregatet som ersätter `IDataStore` i `ctx`.
 * Växer per migrerad entitet (fan-out); samexisterar med `IDataStore` tills
 * sista entiteten migrerats. Egen fil (inte `types.ts`) så bas-kontrakten kan
 * importeras av entitets-repositories utan cirkel-beroende.
 */

import type { InvoiceRepository } from "./invoice-repository";
import type { PaymentPlanRepository } from "./payment-plan-repository";

export interface Repositories {
  invoices: InvoiceRepository;
  paymentPlans: PaymentPlanRepository;
  transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
}
