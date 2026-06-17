/**
 * `buildDrizzleRepositories` (ADR 0020 / #409) — bygger `Repositories`-aggregatet
 * ovanpå en Drizzle/Postgres-`AppDb` (server-authoritativa vägen). Speglar
 * `buildInMemoryRepositories`: samma 28 entiteter, samma `transaction`-semantik.
 *
 * `transaction` använder Drizzles `db.transaction` (riktig SQL-transaktion med
 * rollback vid kast); callbacken får en tx-scopad repos-vy. Nästlad
 * `transaction` i den vyn är reentrant (delar samma tx — ingen ny savepoint),
 * exakt som in-memory-aggregatets reentranta no-op.
 *
 * Server-runtimen (#410) injicerar detta via `buildContext({ repos })`. En
 * konkret Postgres-anslutning (node-postgres/`postgres`) wiras i runtimen — det
 * här laget är driver-agnostiskt (tar emot `AppDb`).
 */

import type { AppDb } from "../db/types";
import { DrizzleAccontoDeductionRepository } from "./drizzle-acconto-deduction-repository";
import { DrizzleBillingRunRepository } from "./drizzle-billing-run-repository";
import { DrizzleCalendarEventRepository } from "./drizzle-calendar-event-repository";
import { DrizzleConflictCheckRepository } from "./drizzle-conflict-check-repository";
import { DrizzleContactRepository } from "./drizzle-contact-repository";
import { DrizzleDocumentFolderRepository } from "./drizzle-document-folder-repository";
import { DrizzleDocumentRepository } from "./drizzle-document-repository";
import { DrizzleDocumentSuggestionRepository } from "./drizzle-document-suggestion-repository";
import { DrizzleDocumentTemplateRepository } from "./drizzle-document-template-repository";
import { DrizzleExpectedReceivableRepository } from "./drizzle-expected-receivable-repository";
import { DrizzleExpenseRepository } from "./drizzle-expense-repository";
import { DrizzleInvoiceDispatchRepository } from "./drizzle-invoice-dispatch-repository";
import { DrizzleInvoiceRepository } from "./drizzle-invoice-repository";
import { DrizzleMatterContactRepository } from "./drizzle-matter-contact-repository";
import { DrizzleMatterEventSuggestionRepository } from "./drizzle-matter-event-suggestion-repository";
import { DrizzleMatterRepository } from "./drizzle-matter-repository";
import { DrizzleOfficeRepository } from "./drizzle-office-repository";
import { DrizzleOrgPreferenceRepository } from "./drizzle-org-preference-repository";
import { DrizzleOrganizationRepository } from "./drizzle-organization-repository";
import { DrizzlePaymentPlanReminderRepository } from "./drizzle-payment-plan-reminder-repository";
import { DrizzlePaymentPlanRepository } from "./drizzle-payment-plan-repository";
import { DrizzlePaymentRepository } from "./drizzle-payment-repository";
import { DrizzleServiceNoteRepository } from "./drizzle-service-note-repository";
import { DrizzleTaskRepository } from "./drizzle-task-repository";
import { DrizzleTimeEntryRepository } from "./drizzle-time-entry-repository";
import { DrizzleUserPreferenceRepository } from "./drizzle-user-preference-repository";
import { DrizzleUserRepository } from "./drizzle-user-repository";
import { DrizzleWriteOffRepository } from "./drizzle-write-off-repository";
import type { Repositories } from "./repositories";

/** De entitets-bundna repona (utan `transaction`) för en given db/tx-handle. */
function entityRepos(db: AppDb): Omit<Repositories, "transaction"> {
  return {
    invoices: new DrizzleInvoiceRepository(db),
    matters: new DrizzleMatterRepository(db),
    payments: new DrizzlePaymentRepository(db),
    writeOffs: new DrizzleWriteOffRepository(db),
    paymentPlans: new DrizzlePaymentPlanRepository(db),
    paymentPlanReminders: new DrizzlePaymentPlanReminderRepository(db),
    timeEntries: new DrizzleTimeEntryRepository(db),
    expenses: new DrizzleExpenseRepository(db),
    accontoDeductions: new DrizzleAccontoDeductionRepository(db),
    billingRuns: new DrizzleBillingRunRepository(db),
    contacts: new DrizzleContactRepository(db),
    matterContacts: new DrizzleMatterContactRepository(db),
    conflictChecks: new DrizzleConflictCheckRepository(db),
    users: new DrizzleUserRepository(db),
    tasks: new DrizzleTaskRepository(db),
    calendarEvents: new DrizzleCalendarEventRepository(db),
    serviceNotes: new DrizzleServiceNoteRepository(db),
    documents: new DrizzleDocumentRepository(db),
    documentFolders: new DrizzleDocumentFolderRepository(db),
    matterEventSuggestions: new DrizzleMatterEventSuggestionRepository(db),
    documentAnalysisSuggestions: new DrizzleDocumentSuggestionRepository(db),
    documentTemplates: new DrizzleDocumentTemplateRepository(db),
    expectedReceivables: new DrizzleExpectedReceivableRepository(db),
    invoiceDispatches: new DrizzleInvoiceDispatchRepository(db),
    organizations: new DrizzleOrganizationRepository(db),
    offices: new DrizzleOfficeRepository(db),
    userPreferences: new DrizzleUserPreferenceRepository(db),
    orgPreferences: new DrizzleOrgPreferenceRepository(db),
  };
}

/** Repos-vy bunden till en pågående tx — nästlad `transaction` är reentrant. */
function reposForTx(tx: AppDb): Repositories {
  const repos: Repositories = { ...entityRepos(tx), transaction: (fn) => fn(repos) };
  return repos;
}

export function buildDrizzleRepositories(db: AppDb): Repositories {
  return {
    ...entityRepos(db),
    transaction: (fn) => db.transaction((tx) => fn(reposForTx(tx as unknown as AppDb))),
  };
}
