/**
 * Drizzle-schemat (ADR 0019), en modul av `schema.ts`:
 * billing: tid, utlägg, fakturor, betalningar, planer, körningar m.m.
 * Importera från `@/lib/server/db/schema`, inte direkt från den här modulen.
 */

import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import type { DispatchChannel, DispatchStatus, ExpectedReceivableStatus } from "@/lib/shared/schemas/billing";
import type {
  AmountRounding, BillingRunRecipient, BillingRunStatus, BillingRunType, ExpenseKind, InvoiceStatus, InvoiceType,
  PaymentPlanStatus, ReminderType, TimeEntryKind,
} from "@/lib/shared/schemas/enums";
import type {
  AccontoDeductionId, BillingRunId, ExpenseId, InvoiceDispatchId, InvoiceId, MatterId, PaymentId, PaymentPlanId,
  PaymentPlanReminderId, TimeEntryId, UserId, WriteOffId,
} from "@/lib/shared/schemas/ids";
import type { InterrogationPause } from "@/lib/shared/schemas/interrogation";
import type { SettlementView } from "@/lib/shared/settlement-view";
import { baseColumns, boolDefault, ore, orgScopedColumns } from "./columns";
import { matters } from "./schema-core";

// ─── Billing (scopar via matter/invoice — ingen egen organization_id) ──────

export const timeEntries = pgTable("time_entries", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<TimeEntryId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  /** Främmande nyckel (migration 0035, #1345): byråavgränsningen går via ärendet. */
  matterId: uuid("matter_id").notNull().$type<MatterId>().references(() => matters.id),
  date: timestamp("date", { withTimezone: true }).notNull(),
  minutes: integer("minutes").notNull(),
  description: text("description").notNull(),
  hourlyRate: integer("hourly_rate").notNull(),
  /** Arvodeskategorin (#891, #950) — null = ARBETE. Styr slutregleringens norm. */
  kind: text("kind").$type<TimeEntryKind>(),
  /** Byråns standardåtgärd posten registrerades ur (#956) — spårbarhet: går att
   *  se vilka poster som kommer ur en standard och om tiden justerats. */
  standardAtgardId: text("standard_atgard_id"),
  billable: boolDefault("billable", true),
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenByBillingRunId: uuid("frozen_by_billing_run_id").$type<BillingRunId>(),
}, (t) => [index("time_entries_matter_idx").on(t.matterId)]);

export const expenses = pgTable("expenses", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<ExpenseId>(),
  userId: uuid("user_id").notNull().$type<UserId>(),
  /** Främmande nyckel (migration 0035, #1345): byråavgränsningen går via ärendet. */
  matterId: uuid("matter_id").notNull().$type<MatterId>().references(() => matters.id),
  date: timestamp("date", { withTimezone: true }).notNull(),
  amount: ore("amount").notNull(),
  description: text("description").notNull(),
  billable: boolDefault("billable", true),
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  // Satsen BYRÅN betalade — styr hur mycket ingående moms som räknas av innan
  // utlägget debiteras vidare med 25 % (#975).
  vatRate: integer("vat_rate").notNull().default(2500),
  // Utlägg lagras netto (exkl moms) — AVA lägger på momsen (#782).
  vatIncluded: boolDefault("vat_included", false),
  // Äkta utlägg (#975): faktura ställd till klienten → vidarefaktureras utan moms.
  passThrough: boolDefault("pass_through", false),
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
  // Persisterad slutregleringsvy (#876) — EN källa för faktura-dokument + Slutfaktura-sida.
  settlementBreakdown: jsonb("settlement_breakdown").$type<SettlementView>(),
  status: text("status").notNull().default("DRAFT").$type<InvoiceStatus>(),
  invoiceType: text("invoice_type").notNull().default("STANDARD").$type<InvoiceType>(),
  invoiceNumber: text("invoice_number"),
  ocrReference: text("ocr_reference"),
  fortnoxId: text("fortnox_id"),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  notes: text("notes"),
  creditedInvoiceId: uuid("credited_invoice_id").$type<InvoiceId>(),
  // Radavrundning (#1438): 'KRONOR' på nya fakturor; null = äldre (öre).
  amountRounding: text("amount_rounding").$type<AmountRounding>(),
}, (t) => [index("invoices_matter_idx").on(t.matterId)]);

/**
 * Register över utfärdade fakturanummer (#1243, ADR 0012) — SERVER-ONLY (ingen
 * entitet, synkas aldrig). Primärnyckeln (byrå, nummer) gör en dubblett
 * omöjlig i databasen: 17 kap. 24 § 2 ML kräver ett löpnummer som ensamt
 * identifierar fakturan. Fakturorna själva scopas via ärendet (ingen egen
 * org-kolumn), därför registret i stället för ett index på `invoices`.
 */
export const invoiceNumbers = pgTable("invoice_numbers", {
  organizationId: uuid("organization_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceId: uuid("invoice_id").notNull().$type<InvoiceId>(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.invoiceNumber] })]);

export const payments = pgTable("payments", {
  ...baseColumns,
  id: uuid("id").primaryKey().$type<PaymentId>(),
  invoiceId: uuid("invoice_id").notNull().$type<InvoiceId>(),
  amount: ore("amount").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  note: text("note"),
  reference: text("reference"),
  /** Verifikat i bokföringssystemet (#1173). */
  fortnoxId: text("fortnox_id"),
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
  /** KR-livscykel (#828): status + dömt belopp + slutgiltigt (efter hovrätten). */
  kostnadsrakningStatus: text("kostnadsrakning_status").$type<KostnadsrakningStatus>(),
  /** KR-referensnummer `KR-YYYY-NNNN` (#889). Null för icke-KR-körningar. */
  reference: text("reference"),
  awardedOre: ore("awarded_ore"),
  beslutSlutgiltigt: boolean("beslut_slutgiltigt").notNull().default(false),
  invoiceId: uuid("invoice_id").$type<InvoiceId>(),
  deductedBillingRunIds: jsonb("deducted_billing_run_ids").notNull().default([]).$type<BillingRunId[]>(),
  periodFrom: timestamp("period_from", { withTimezone: true }),
  periodTo: timestamp("period_to", { withTimezone: true }),
  notes: text("notes"),
}, (t) => [index("billing_runs_matter_idx").on(t.matterId)]);

/**
 * Register över utfärdade KR-referenser (#1379) — SERVER-ONLY, synkas aldrig.
 * Samma mönster som `invoice_numbers`: primärnyckeln (byrå, referens) gör en
 * dubblett omöjlig även om två kostnadsräkningar skickas in samtidigt.
 * Körningarna scopas via ärendet (ingen egen org-kolumn), därför registret i
 * stället för ett unikt index på `billing_runs`.
 */
export const krReferences = pgTable("kr_references", {
  organizationId: uuid("organization_id").notNull(),
  reference: text("reference").notNull(),
  billingRunId: uuid("billing_run_id").notNull().$type<BillingRunId>(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.reference] })]);

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

/**
 * Förhör i förordnandemål (#1855, DVFS 2025:5): början, slut och uppehåll.
 * Fälten heter som domänens `Forhor`; kolumnerna `start_at`/`end_at`.
 */
export const interrogations = pgTable("interrogations", {
  ...orgScopedColumns,
  matterId: uuid("matter_id").notNull().$type<MatterId>().references(() => matters.id),
  start: timestamp("start_at", { withTimezone: true }).notNull(),
  end: timestamp("end_at", { withTimezone: true }).notNull(),
  pauses: jsonb("pauses").notNull().default([]).$type<InterrogationPause[]>(),
}, (t) => [index("interrogations_matter_idx").on(t.matterId)]);
