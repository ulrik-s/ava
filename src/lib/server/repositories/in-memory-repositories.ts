/**
 * `buildInMemoryRepositories` (ADR 0020, #409 Fas 2b) — bygger `Repositories`-
 * aggregatet ovanpå en `IDataStore` (browser/offline/demo-vägen). In-memory-
 * repona delegerar internt till store:ns query-engine (#412).
 *
 * `transaction` återanvänder store:ns snapshot/rollback och ger callbacken en
 * tx-scopad repos-vy; nästlad `transaction` i den vyn är reentrant (no-op
 * snapshot — yttre nivån committar), speglar `DemoDataStore.transaction`.
 */

import type { DataStoreTx, IDataStore } from "../data-store/IDataStore";
import { InMemoryInvoiceRepository } from "./in-memory-invoice-repository";
import { InMemoryPaymentPlanRepository } from "./in-memory-payment-plan-repository";
import type { Repositories } from "./repositories";

/** Repos-vy bunden till en transaktions-tx (reentrant transaction). */
function reposForTx(tx: DataStoreTx): Repositories {
  const repos: Repositories = {
    invoices: new InMemoryInvoiceRepository(tx),
    paymentPlans: new InMemoryPaymentPlanRepository(tx),
    transaction: (fn) => fn(repos),
  };
  return repos;
}

export function buildInMemoryRepositories(dataStore: IDataStore): Repositories {
  return {
    invoices: new InMemoryInvoiceRepository(dataStore),
    paymentPlans: new InMemoryPaymentPlanRepository(dataStore),
    transaction: (fn) => dataStore.transaction((tx) => fn(reposForTx(tx))),
  };
}
