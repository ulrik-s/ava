/**
 * Drizzle-schema för Postgres-backenden (ADR 0019, #408) — alla entiteter:
 * kärn-identitet + ärende, billing (faktura/tid/utlägg/betalning/plan/run/…),
 * dokument, kalender/task, tjänsteanteckning, preferenser, mallar, jävssök, samt
 * den globala `change_log` som driver delta-sync (ADR 0017).
 *
 * Speglar zod-schemana i `src/lib/shared/schemas/` (zod = sanningskälla, ADR 0019).
 * Enum-fält lagras som `text` (samma strängvärden som zod-enums). Monetära öre-
 * belopp + sizeBytes är `bigint` (mode:number) för att undvika int4-overflow.
 * Reconcile-konventionerna (version/updatedAt/deletedAt) gäller ALLA tabeller,
 * även de vars zod-schema saknar dem (zod `.passthrough()` tolererar vid läsning).
 */

import { relations } from "drizzle-orm";
import { bigint, bigserial, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { DispatchChannel, DispatchStatus, ExpectedReceivableStatus } from "@/lib/shared/schemas/billing";
import type {
  CalendarEventKind, CalendarEventVisibility, TaskPriority, TaskStatus,
} from "@/lib/shared/schemas/calendar";
import type {
  BillingRunRecipient, BillingRunStatus, BillingRunType, ContactType, ExpenseKind, InvoiceStatus,
  InvoiceType, MatterRole, MatterStatus, PaymentMethod, PaymentPlanStatus, ReminderType,
  SuggestionStatus, UserRole,
} from "@/lib/shared/schemas/enums";
import type {
  AccontoDeductionId, BillingRunId, CalendarEventId, ConflictCheckId, ContactId,
  DocumentAnalysisSuggestionId, DocumentFolderId, DocumentId,
  DocumentTemplateId, ExpenseId, InvoiceDispatchId, InvoiceId, MatterContactId, MatterEventSuggestionId,
  MatterId, OfficeId, OrganizationId, OrgPreferenceId, PaymentId, PaymentPlanId, PaymentPlanReminderId,
  ServiceNoteId, TaskId, TimeEntryId, UserId, UserPreferenceId, WriteOffId,
} from "@/lib/shared/schemas/ids";
import { baseColumns, boolDefault, orgScopedColumns } from "./columns";

/** Monetärt öre-belopp (bigint → ingen int4-overflow för stora fakturor). */
const ore = (name: string) => bigint(name, { mode: "number" });

export const organizations = pgTable("organizations", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<OrganizationId>(),
  name: text("name").notNull(),
  orgNumber: text("org_number"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  bankgiro: text("bankgiro"),
  logoPath: text("logo_path"),
  azureTenantId: text("azure_tenant_id"),
  ledgerAccountMap: jsonb("ledger_account_map"),
  /** Byråns vokabulär av giltiga dokument-etiketter (#621). Dokument får bara
   *  bära taggar ur denna lista; hanteras i org-inställningarna. */
  documentTags: jsonb("document_tags").notNull().default([]).$type<string[]>(),
});

export const offices = pgTable("offices", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<OfficeId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isMain: boolDefault("is_main", false),
});

export const users = pgTable("users", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<UserId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  role: text("role").notNull().default("LAWYER").$type<UserRole>(),
  matterNumberPrefix: text("matter_number_prefix"),
  hourlyRate: integer("hourly_rate"),
  mileageRate: integer("mileage_rate"),
  active: boolDefault("active", true),
  passwordHash: text("password_hash"),
  azureOid: text("azure_oid"),
  oidcSubject: text("oidc_subject"),
  oidcIssuer: text("oidc_issuer"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => [index("users_org_idx").on(t.organizationId)]);

export const contacts = pgTable("contacts", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<ContactId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  name: text("name").notNull(),
  contactType: text("contact_type").notNull().default("PERSON").$type<ContactType>(),
  personalNumber: text("personal_number"),
  orgNumber: text("org_number"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  parentId: uuid("parent_id").$type<ContactId>(),
}, (t) => [index("contacts_org_idx").on(t.organizationId)]);

export const matters = pgTable("matters", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<MatterId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  matterNumber: text("matter_number").notNull(),
  responsibleLawyerId: uuid("responsible_lawyer_id").$type<UserId>(),
  courtCaseNumber: text("court_case_number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ACTIVE").$type<MatterStatus>(),
  matterType: text("matter_type"),
  paymentMethod: text("payment_method").notNull().default("PENDING").$type<PaymentMethod>(),
  paymentMethodNote: text("payment_method_note"),
  paymentMethodDecidedAt: timestamp("payment_method_decided_at", { withTimezone: true }),
  isTaxeArende: boolDefault("is_taxe_arende", false),
  taxaLevel: integer("taxa_level"),
  taxaHuvudforhandlingMin: integer("taxa_huvudforhandling_min"),
  taxaHasFTax: boolDefault("taxa_has_f_tax", false),
  taxaHufStart: timestamp("taxa_huf_start", { withTimezone: true }),
  radgivningBetaldAt: timestamp("radgivning_betald_at", { withTimezone: true }),
  /** Klientens andel (självrisk/avgift) i bips — rättsskydd/rättshjälp (#778). */
  clientShareBips: integer("client_share_bips"),
}, (t) => [index("matters_org_idx").on(t.organizationId)]);

/**
 * MatterContact — join Contact↔Matter med roll. zod-schemat saknar
 * updatedAt/version men reconcile-konventionerna (ADR 0017) ger dem ändå
 * (zod `.passthrough()` tolererar extra fält vid läsning). Org-scope härleds
 * via matter, så ingen egen `organization_id`.
 */
export const matterContacts = pgTable("matter_contacts", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<MatterContactId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  contactId: uuid("contact_id").notNull().$type<ContactId>(),
  role: text("role").notNull().$type<MatterRole>(),
  notes: text("notes"),
}, (t) => [index("matter_contacts_matter_idx").on(t.matterId)]);

/**
 * Global change-log (ADR 0019 beslut 4) — driver delta-sync: en monoton
 * `seq` per org. Klientens pull = rader där `seq > cursor AND org_id = :org`.
 * `op` = create | update | delete (tombstone). En rad per accepterad skrivning.
 */
export const changeLog = pgTable("change_log", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  entity: text("entity").notNull(),
  rowId: uuid("row_id").notNull(),
  version: integer("version").notNull(),
  op: text("op").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("change_log_org_seq_idx").on(t.organizationId, t.seq)]);

// ─── Billing (scopar via matter/invoice — ingen egen organization_id) ──────

export const timeEntries = pgTable("time_entries", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<TimeEntryId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  minutes: integer("minutes").notNull(),
  description: text("description").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  billable: boolDefault("billable", true),
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenByBillingRunId: uuid("frozen_by_billing_run_id").$type<BillingRunId>(),
}, (t) => [index("time_entries_matter_idx").on(t.matterId)]);

export const expenses = pgTable("expenses", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<ExpenseId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  amount: ore("amount").notNull(),
  description: text("description").notNull(),
  billable: boolDefault("billable", true),
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  vatRate: integer("vat_rate").notNull().default(2500),
  // Utlägg lagras netto (exkl moms) — AVA lägger på momsen (#782).
  vatIncluded: boolDefault("vat_included", false),
  kind: text("kind").notNull().default("EXPENSE").$type<ExpenseKind>(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenByBillingRunId: uuid("frozen_by_billing_run_id").$type<BillingRunId>(),
}, (t) => [index("expenses_matter_idx").on(t.matterId)]);

export const invoices = pgTable("invoices", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<InvoiceId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  amount: ore("amount").notNull(),
  // Momsbeloppet i `amount`, exakt per sats vid skapande (#782); netto = amount − vatOre.
  vatOre: integer("vat_ore"),
  // Moms-uppdelning per sats (#790) — driver per-sats bokföring i verifikat/SIE.
  vatBreakdown: jsonb("vat_breakdown").$type<Array<{ kind: "arvode" | "utlagg"; vatRate: number; netOre: number; vatOre: number }>>(),
  status: text("status").notNull().default("DRAFT").$type<InvoiceStatus>(),
  invoiceType: text("invoice_type").notNull().default("STANDARD").$type<InvoiceType>(),
  invoiceNumber: text("invoice_number"),
  ocrReference: text("ocr_reference"),
  fortnoxId: text("fortnox_id"),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  notes: text("notes"),
  creditedInvoiceId: uuid("credited_invoice_id").$type<InvoiceId>(),
}, (t) => [index("invoices_matter_idx").on(t.matterId)]);

export const payments = pgTable("payments", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<PaymentId>(),
  invoiceId: uuid("invoice_id").notNull().$type<InvoiceId>(),
  amount: ore("amount").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  note: text("note"),
  reference: text("reference"),
  recordedById: uuid("recorded_by_id").notNull().$type<UserId>(),
}, (t) => [index("payments_invoice_idx").on(t.invoiceId)]);

export const writeOffs = pgTable("write_offs", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<WriteOffId>(),
  invoiceId: uuid("invoice_id").notNull().$type<InvoiceId>(),
  amount: ore("amount").notNull(),
  writtenOffAt: timestamp("written_off_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  recordedById: uuid("recorded_by_id").notNull().$type<UserId>(),
}, (t) => [index("write_offs_invoice_idx").on(t.invoiceId)]);

export const invoiceDispatches = pgTable("invoice_dispatches", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<InvoiceDispatchId>(),
  invoiceId: uuid("invoice_id").notNull().$type<InvoiceId>(),
  channel: text("channel").notNull().$type<DispatchChannel>(),
  recipient: text("recipient").notNull(),
  status: text("status").notNull().default("queued").$type<DispatchStatus>(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  messageId: text("message_id"),
  error: text("error"),
  recordedById: uuid("recorded_by_id").notNull().$type<UserId>(),
}, (t) => [index("invoice_dispatches_invoice_idx").on(t.invoiceId)]);

export const paymentPlans = pgTable("payment_plans", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<PaymentPlanId>(),
  invoiceId: uuid("invoice_id").notNull().$type<InvoiceId>(),
  monthlyAmount: ore("monthly_amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("ACTIVE").$type<PaymentPlanStatus>(),
  notes: text("notes"),
}, (t) => [index("payment_plans_invoice_idx").on(t.invoiceId)]);

export const paymentPlanReminders = pgTable("payment_plan_reminders", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<PaymentPlanReminderId>(),
  planId: uuid("plan_id").notNull().$type<PaymentPlanId>(),
  dueMonth: text("due_month").notNull(),
  type: text("type").notNull().$type<ReminderType>(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
}, (t) => [index("payment_plan_reminders_plan_idx").on(t.planId)]);

export const accontoDeductions = pgTable("acconto_deductions", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<AccontoDeductionId>(),
  finalInvoiceId: uuid("final_invoice_id").notNull().$type<InvoiceId>(),
  accontoInvoiceId: uuid("acconto_invoice_id").notNull().$type<InvoiceId>(),
});

export const billingRuns = pgTable("billing_runs", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<BillingRunId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  type: text("type").notNull().$type<BillingRunType>(),
  recipient: text("recipient").notNull().$type<BillingRunRecipient>(),
  status: text("status").notNull().default("DRAFT").$type<BillingRunStatus>(),
  workValueOreAtRun: ore("work_value_ore_at_run").notNull(),
  clientShareBips: integer("client_share_bips"),
  proposedAmountOre: ore("proposed_amount_ore").notNull(),
  amountOre: ore("amount_ore").notNull(),
  prutningOre: ore("prutning_ore"),
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  deductedBillingRunIds: jsonb("deducted_billing_run_ids").notNull().default([]).$type<BillingRunId[]>(),
  periodFrom: timestamp("period_from", { withTimezone: true }),
  periodTo: timestamp("period_to", { withTimezone: true }),
  notes: text("notes"),
}, (t) => [index("billing_runs_matter_idx").on(t.matterId)]);

export const expectedReceivables = pgTable("expected_receivables", {
  ...orgScopedColumns,
  matterId: uuid("matter_id").notNull(),
  description: text("description").notNull(),
  expectedAmount: ore("expected_amount").notNull(),
  status: text("status").notNull().default("PENDING").$type<ExpectedReceivableStatus>(),
  settledAmount: ore("settled_amount"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  paymentReference: text("payment_reference"),
  recordedById: uuid("recorded_by_id").notNull(),
}, (t) => [index("expected_receivables_matter_idx").on(t.matterId)]);

// ─── Dokument ──────────────────────────────────────────────────────────────

export const documentFolders = pgTable("document_folders", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentFolderId>(),
  name: text("name").notNull(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  parentId: uuid("parent_id").$type<DocumentFolderId>(),
}, (t) => [index("document_folders_matter_idx").on(t.matterId)]);

export const documents = pgTable("documents", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  /** Valfri faktura-koppling (#397: genererade faktura-dokument). */
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  folderId: uuid("folder_id").$type<DocumentFolderId>(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storagePath: text("storage_path").notNull(),
  uploadedById: uuid("uploaded_by_id").notNull().$type<UserId>(),
  title: text("title"),
  documentType: text("document_type"),
  /** Fria etiketter ur byråns vokabulär (#621) — komplement till documentType.
   *  Sätts av LLM (förslag) + användare; skrivs via updateMetadata (ingen
   *  version-bump, #619). */
  tags: jsonb("tags").notNull().default([]).$type<string[]>(),
  summary: text("summary"),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  analysisStatus: text("analysis_status").$type<"PENDING" | "RUNNING" | "DONE" | "ERROR">(),
  analysisModel: text("analysis_model"),
  analysisError: text("analysis_error"),
}, (t) => [index("documents_matter_idx").on(t.matterId)]);

export const documentAnalysisSuggestions = pgTable("document_analysis_suggestions", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<DocumentAnalysisSuggestionId>(),
  documentId: uuid("document_id").notNull().$type<DocumentId>(),
  name: text("name").notNull(),
  role: text("role").notNull().$type<MatterRole>(),
  contactType: text("contact_type").notNull().$type<ContactType>(),
  email: text("email"),
  phone: text("phone"),
  orgNumber: text("org_number"),
  personalNumber: text("personal_number"),
  notes: text("notes"),
  status: text("status").notNull().default("PENDING").$type<SuggestionStatus>(),
  acceptedContactId: uuid("accepted_contact_id").$type<ContactId>(),
}, (t) => [index("doc_analysis_suggestions_doc_idx").on(t.documentId)]);

export const matterEventSuggestions = pgTable("matter_event_suggestions", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<MatterEventSuggestionId>(),
  documentId: uuid("document_id").notNull().$type<DocumentId>(),
  title: text("title").notNull(),
  description: text("description"),
  eventType: text("event_type"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolDefault("all_day", false),
  location: text("location"),
  status: text("status").notNull().default("PENDING").$type<SuggestionStatus>(),
}, (t) => [index("matter_event_suggestions_doc_idx").on(t.documentId)]);

// ─── Kalender / Task ─────────────────────────────────────────────────────────

export const calendarEvents = pgTable("calendar_events", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<CalendarEventId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  kind: text("kind").notNull().default("appointment").$type<CalendarEventKind>(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolDefault("all_day", false),
  matterId: uuid("matter_id").$type<MatterId>(),
  visibility: text("visibility").notNull().default("normal").$type<CalendarEventVisibility>(),
  mirrorToOutlook: boolDefault("mirror_to_outlook", false),
  outlookEventId: text("outlook_event_id"),
  outlookCalendarId: text("outlook_calendar_id"),
  mirrorStatus: text("mirror_status").$type<"pending" | "synced" | "failed">(),
  mirrorError: text("mirror_error"),
  mirrorLastSyncedAt: timestamp("mirror_last_synced_at", { withTimezone: true }),
}, (t) => [index("calendar_events_user_idx").on(t.userId)]);

export const tasks = pgTable("tasks", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<TaskId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("TODO").$type<TaskStatus>(),
  priority: text("priority").notNull().default("MEDIUM").$type<TaskPriority>(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  matterId: uuid("matter_id").$type<MatterId>(),
}, (t) => [index("tasks_user_idx").on(t.userId)]);

// ─── Tjänsteanteckning / Preferenser / Mallar / Jävssök ──────────────────────

export const serviceNotes = pgTable("service_notes", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<ServiceNoteId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  matterId: uuid("matter_id").notNull().$type<MatterId>(),
  authorId: uuid("author_id").notNull().$type<UserId>(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  text: text("text").notNull(),
}, (t) => [index("service_notes_matter_idx").on(t.matterId)]);

export const userPreferences = pgTable("user_preferences", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<UserPreferenceId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  organizationId: uuid("organization_id").$type<OrganizationId>(),
  key: text("key").notNull(),
  prefs: jsonb("prefs").notNull().$type<Record<string, unknown>>(),
}, (t) => [index("user_preferences_user_idx").on(t.userId)]);

export const orgPreferences = pgTable("org_preferences", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<OrgPreferenceId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  key: text("key").notNull(),
  prefs: jsonb("prefs").notNull().$type<Record<string, unknown>>(),
  createdById: uuid("created_by_id").$type<UserId>(),
});

export const documentTemplates = pgTable("document_templates", {
  ...orgScopedColumns,
  id: uuid("id").primaryKey().$type<DocumentTemplateId>(),
  organizationId: uuid("organization_id").notNull().$type<OrganizationId>(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  content: text("content").notNull(),
  createdById: uuid("created_by_id").notNull().$type<UserId>(),
});

export const conflictChecks = pgTable("conflict_checks", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<ConflictCheckId>(),
  searchTerm: text("search_term").notNull(),
  searchType: text("search_type").notNull().$type<"name" | "personalNumber" | "both">(),
  results: jsonb("results").notNull().default([]).$type<unknown[]>(),
  checkedById: uuid("checked_by_id").notNull().$type<UserId>(),
});

// ─── Relations (ADR 0020) — driver Drizzles relationella `with`-queries för
//     repository-läsningar (getByIdWith…/list). Genererar ingen SQL (app-nivå).
//     Self-ref/dubbel-FK (accontoDeductions, credited/creditNote) hanteras via
//     explicita sekundär-queries i repona (undviker relationName-komplexitet här).

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  matter: one(matters, { fields: [invoices.matterId], references: [matters.id] }),
  payments: many(payments),
  writeOffs: many(writeOffs),
  paymentPlan: one(paymentPlans),
  timeEntries: many(timeEntries),
  expenses: many(expenses),
  documents: many(documents),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  recordedBy: one(users, { fields: [payments.recordedById], references: [users.id] }),
}));

export const writeOffsRelations = relations(writeOffs, ({ one }) => ({
  invoice: one(invoices, { fields: [writeOffs.invoiceId], references: [invoices.id] }),
}));

export const paymentPlansRelations = relations(paymentPlans, ({ one, many }) => ({
  invoice: one(invoices, { fields: [paymentPlans.invoiceId], references: [invoices.id] }),
  reminders: many(paymentPlanReminders),
}));

export const paymentPlanRemindersRelations = relations(paymentPlanReminders, ({ one }) => ({
  plan: one(paymentPlans, { fields: [paymentPlanReminders.planId], references: [paymentPlans.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  invoice: one(invoices, { fields: [timeEntries.invoiceId], references: [invoices.id] }),
  matter: one(matters, { fields: [timeEntries.matterId], references: [matters.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  invoice: one(invoices, { fields: [expenses.invoiceId], references: [invoices.id] }),
  matter: one(matters, { fields: [expenses.matterId], references: [matters.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  invoice: one(invoices, { fields: [documents.invoiceId], references: [invoices.id] }),
  matter: one(matters, { fields: [documents.matterId], references: [matters.id] }),
}));

// matter↔kontakt via junction (matterContacts). Driver `with`-nesting för
// repository-läsningar som behöver KLIENT-kontakten (paymentPlan/matter m.fl.).
export const mattersRelations = relations(matters, ({ many }) => ({
  contacts: many(matterContacts),
}));

export const matterContactsRelations = relations(matterContacts, ({ one }) => ({
  matter: one(matters, { fields: [matterContacts.matterId], references: [matters.id] }),
  contact: one(contacts, { fields: [matterContacts.contactId], references: [contacts.id] }),
}));
