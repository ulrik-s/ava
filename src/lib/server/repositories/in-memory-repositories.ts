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
import { InMemoryAccontoDeductionRepository } from "./in-memory-acconto-deduction-repository";
import { InMemoryCalendarEventRepository } from "./in-memory-calendar-event-repository";
import { InMemoryContactRepository } from "./in-memory-contact-repository";
import { InMemoryDocumentFolderRepository } from "./in-memory-document-folder-repository";
import { InMemoryDocumentRepository } from "./in-memory-document-repository";
import { InMemoryDocumentTemplateRepository } from "./in-memory-document-template-repository";
import { InMemoryExpectedReceivableRepository } from "./in-memory-expected-receivable-repository";
import { InMemoryExpenseRepository } from "./in-memory-expense-repository";
import { InMemoryInvoiceDispatchRepository } from "./in-memory-invoice-dispatch-repository";
import { InMemoryInvoiceRepository } from "./in-memory-invoice-repository";
import { InMemoryMatterEventSuggestionRepository } from "./in-memory-matter-event-suggestion-repository";
import { InMemoryMatterRepository } from "./in-memory-matter-repository";
import { InMemoryOfficeRepository } from "./in-memory-office-repository";
import { InMemoryOrgPreferenceRepository } from "./in-memory-org-preference-repository";
import { InMemoryOrganizationRepository } from "./in-memory-organization-repository";
import { InMemoryPaymentPlanRepository } from "./in-memory-payment-plan-repository";
import { InMemoryPaymentRepository } from "./in-memory-payment-repository";
import { InMemoryServiceNoteRepository } from "./in-memory-service-note-repository";
import { InMemoryTaskRepository } from "./in-memory-task-repository";
import { InMemoryTimeEntryRepository } from "./in-memory-time-entry-repository";
import { InMemoryUserPreferenceRepository } from "./in-memory-user-preference-repository";
import { InMemoryUserRepository } from "./in-memory-user-repository";
import { InMemoryWriteOffRepository } from "./in-memory-write-off-repository";
import type { Repositories } from "./repositories";

/** Repos-vy bunden till en transaktions-tx (reentrant transaction). */
function reposForTx(tx: DataStoreTx): Repositories {
  const repos: Repositories = {
    invoices: new InMemoryInvoiceRepository(tx),
    matters: new InMemoryMatterRepository(tx),
    payments: new InMemoryPaymentRepository(tx),
    writeOffs: new InMemoryWriteOffRepository(tx),
    paymentPlans: new InMemoryPaymentPlanRepository(tx),
    timeEntries: new InMemoryTimeEntryRepository(tx),
    expenses: new InMemoryExpenseRepository(tx),
    accontoDeductions: new InMemoryAccontoDeductionRepository(tx),
    contacts: new InMemoryContactRepository(tx),
    users: new InMemoryUserRepository(tx),
    tasks: new InMemoryTaskRepository(tx),
    calendarEvents: new InMemoryCalendarEventRepository(tx),
    serviceNotes: new InMemoryServiceNoteRepository(tx),
    documents: new InMemoryDocumentRepository(tx),
    documentFolders: new InMemoryDocumentFolderRepository(tx),
    matterEventSuggestions: new InMemoryMatterEventSuggestionRepository(tx),
    documentTemplates: new InMemoryDocumentTemplateRepository(tx),
    expectedReceivables: new InMemoryExpectedReceivableRepository(tx),
    invoiceDispatches: new InMemoryInvoiceDispatchRepository(tx),
    organizations: new InMemoryOrganizationRepository(tx),
    offices: new InMemoryOfficeRepository(tx),
    userPreferences: new InMemoryUserPreferenceRepository(tx),
    orgPreferences: new InMemoryOrgPreferenceRepository(tx),
    transaction: (fn) => fn(repos),
  };
  return repos;
}

export function buildInMemoryRepositories(dataStore: IDataStore): Repositories {
  return {
    invoices: new InMemoryInvoiceRepository(dataStore),
    matters: new InMemoryMatterRepository(dataStore),
    payments: new InMemoryPaymentRepository(dataStore),
    writeOffs: new InMemoryWriteOffRepository(dataStore),
    paymentPlans: new InMemoryPaymentPlanRepository(dataStore),
    timeEntries: new InMemoryTimeEntryRepository(dataStore),
    expenses: new InMemoryExpenseRepository(dataStore),
    accontoDeductions: new InMemoryAccontoDeductionRepository(dataStore),
    contacts: new InMemoryContactRepository(dataStore),
    users: new InMemoryUserRepository(dataStore),
    tasks: new InMemoryTaskRepository(dataStore),
    calendarEvents: new InMemoryCalendarEventRepository(dataStore),
    serviceNotes: new InMemoryServiceNoteRepository(dataStore),
    documents: new InMemoryDocumentRepository(dataStore),
    documentFolders: new InMemoryDocumentFolderRepository(dataStore),
    matterEventSuggestions: new InMemoryMatterEventSuggestionRepository(dataStore),
    documentTemplates: new InMemoryDocumentTemplateRepository(dataStore),
    expectedReceivables: new InMemoryExpectedReceivableRepository(dataStore),
    invoiceDispatches: new InMemoryInvoiceDispatchRepository(dataStore),
    organizations: new InMemoryOrganizationRepository(dataStore),
    offices: new InMemoryOfficeRepository(dataStore),
    userPreferences: new InMemoryUserPreferenceRepository(dataStore),
    orgPreferences: new InMemoryOrgPreferenceRepository(dataStore),
    transaction: (fn) => dataStore.transaction((tx) => fn(reposForTx(tx))),
  };
}
