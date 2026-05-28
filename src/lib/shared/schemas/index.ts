/**
 * Git-db entity schemas — single source of truth.
 *
 * Varje JSON-fil i git-working-copy:n motsvarar en rad i en av dessa entiteter.
 * Schemana används av:
 *   - `hydrate-working-copy.ts` — runtime-validering vid LÄS från git
 *   - `fsa-write-back.ts` — runtime-validering vid SKRIVNING till git
 *   - tRPC-routrar — som input-validering för create/update-mutations
 *   - Tester — som factory:s för giltig testdata
 *
 * `ENTITY_REGISTRY` mappar varje entitet → { schema, gitPath }. Det är
 * single source of truth för "vad finns i git-db:n och vart skrivs det".
 */

import { z } from "zod";
import { organizationSchema, officeSchema } from "./organization";
import { userSchema } from "./user";
import { contactSchema } from "./contact";
import { matterSchema, matterContactSchema } from "./matter";
import {
  documentSchema,
  documentFolderSchema,
  documentAnalysisSuggestionSchema,
  matterEventSuggestionSchema,
} from "./document";
import {
  timeEntrySchema,
  expenseSchema,
  invoiceSchema,
  paymentSchema,
  paymentPlanSchema,
  paymentPlanReminderSchema,
  accontoDeductionSchema,
} from "./billing";
import { documentTemplateSchema, conflictCheckSchema } from "./misc";
import { calendarEventSchema, taskSchema } from "./calendar";
import { userPreferenceSchema, orgPreferenceSchema } from "./preference";

export * from "./enums";
export * from "./common";
export * from "./organization";
export * from "./user";
export * from "./contact";
export * from "./matter";
export * from "./document";
export * from "./billing";
export * from "./misc";
export * from "./calendar";

/**
 * Pathfunktion för en entitet. Andra argumentet är raden själv — vissa
 * entiteter (t.ex. user) använder fält ur raden i path:n (email istället
 * för id). Använd `_row` om du inte behöver det.
 */
export type PathFn = (id: string, row: Record<string, unknown>) => string;

/** En entry i registry:t. */
export interface EntityEntry {
  schema: z.ZodTypeAny;
  /** Function som ger git-path:en för en rad. */
  gitPath: PathFn;
  /** För hydrate-working-copy: vilken prefix i git som ska skannas. */
  gitPrefix: string;
  /** I DemoSource-mapen: vilken plural-nyckel ligger raden under. */
  sourceKey: string;
}

// Hjälpare: vissa entiteter använder bara id i pathen. Wrapping i p()
// uniformerar signaturen så TS:s `as const`-narrowing inte gör entries
// inkompatibla med PathFn.
const p = (fn: (id: string) => string): PathFn => (id) => fn(id);

export const ENTITY_REGISTRY: Record<string, EntityEntry> = {
  organization: {
    schema: organizationSchema,
    gitPath: p((id) => `.ava/organizations/${id}.json`),
    gitPrefix: ".ava/organizations",
    sourceKey: "organizations",
  },
  office: {
    schema: officeSchema,
    gitPath: p((id) => `offices/${id}.json`),
    gitPrefix: "offices",
    sourceKey: "offices",
  },
  user: {
    schema: userSchema,
    // Pathen använder email (stabil identifierare) istället för id så
    // .ava/users/<email>.json går att läsa direkt utan id-lookup.
    gitPath: (id, row) => `.ava/users/${(row.email as string) ?? id}.json`,
    gitPrefix: ".ava/users",
    sourceKey: "users",
  },
  contact: {
    schema: contactSchema,
    gitPath: p((id) => `contacts/${id}.json`),
    gitPrefix: "contacts",
    sourceKey: "contacts",
  },
  matter: {
    schema: matterSchema,
    gitPath: p((id) => `matters/active/${id}.json`),
    gitPrefix: "matters/active",
    sourceKey: "matters",
  },
  matterContact: {
    schema: matterContactSchema,
    gitPath: p((id) => `matter-contacts/${id}.json`),
    gitPrefix: "matter-contacts",
    sourceKey: "matterContacts",
  },
  document: {
    schema: documentSchema,
    gitPath: p((id) => `documents/${id}.json`),
    gitPrefix: "documents",
    sourceKey: "documents",
  },
  documentFolder: {
    schema: documentFolderSchema,
    gitPath: p((id) => `document-folders/${id}.json`),
    gitPrefix: "document-folders",
    sourceKey: "documentFolders",
  },
  documentAnalysisSuggestion: {
    schema: documentAnalysisSuggestionSchema,
    gitPath: p((id) => `document-analysis-suggestions/${id}.json`),
    gitPrefix: "document-analysis-suggestions",
    sourceKey: "documentAnalysisSuggestions",
  },
  matterEventSuggestion: {
    schema: matterEventSuggestionSchema,
    gitPath: p((id) => `matter-event-suggestions/${id}.json`),
    gitPrefix: "matter-event-suggestions",
    sourceKey: "matterEventSuggestions",
  },
  timeEntry: {
    schema: timeEntrySchema,
    gitPath: p((id) => `time-entries/${id}.json`),
    gitPrefix: "time-entries",
    sourceKey: "timeEntries",
  },
  expense: {
    schema: expenseSchema,
    gitPath: p((id) => `expenses/${id}.json`),
    gitPrefix: "expenses",
    sourceKey: "expenses",
  },
  invoice: {
    schema: invoiceSchema,
    gitPath: p((id) => `invoices/${id}.json`),
    gitPrefix: "invoices",
    sourceKey: "invoices",
  },
  payment: {
    schema: paymentSchema,
    gitPath: p((id) => `payments/${id}.json`),
    gitPrefix: "payments",
    sourceKey: "payments",
  },
  paymentPlan: {
    schema: paymentPlanSchema,
    gitPath: p((id) => `payment-plans/${id}.json`),
    gitPrefix: "payment-plans",
    sourceKey: "paymentPlans",
  },
  paymentPlanReminder: {
    schema: paymentPlanReminderSchema,
    gitPath: p((id) => `payment-plan-reminders/${id}.json`),
    gitPrefix: "payment-plan-reminders",
    sourceKey: "paymentPlanReminders",
  },
  accontoDeduction: {
    schema: accontoDeductionSchema,
    gitPath: p((id) => `acconto-deductions/${id}.json`),
    gitPrefix: "acconto-deductions",
    sourceKey: "accontoDeductions",
  },
  documentTemplate: {
    schema: documentTemplateSchema,
    gitPath: p((id) => `.ava/templates/${id}.json`),
    gitPrefix: ".ava/templates",
    sourceKey: "documentTemplates",
  },
  conflictCheck: {
    schema: conflictCheckSchema,
    gitPath: p((id) => `conflict-checks/${id}.json`),
    gitPrefix: "conflict-checks",
    sourceKey: "conflictChecks",
  },
  calendarEvent: {
    schema: calendarEventSchema,
    // Flat path; userId-fältet i raden räcker för per-user-filtrering
    // (samma mönster som time-entries, expenses).
    gitPath: p((id) => `calendar/${id}.json`),
    gitPrefix: "calendar",
    sourceKey: "calendarEvents",
  },
  task: {
    schema: taskSchema,
    gitPath: p((id) => `tasks/${id}.json`),
    gitPrefix: "tasks",
    sourceKey: "tasks",
  },
  userPreference: {
    schema: userPreferenceSchema,
    gitPath: p((id) => `.ava/user-preferences/${id}.json`),
    gitPrefix: ".ava/user-preferences",
    sourceKey: "userPreferences",
  },
  orgPreference: {
    schema: orgPreferenceSchema,
    gitPath: p((id) => `.ava/org-preferences/${id}.json`),
    gitPrefix: ".ava/org-preferences",
    sourceKey: "orgPreferences",
  },
};

/** Union av alla giltiga entity-namn (strängliteraler). */
export type EntityName =
  | "organization" | "office" | "user" | "contact" | "matter" | "matterContact"
  | "document" | "documentFolder" | "documentAnalysisSuggestion" | "matterEventSuggestion"
  | "timeEntry" | "expense" | "invoice" | "payment" | "paymentPlan"
  | "paymentPlanReminder" | "accontoDeduction" | "documentTemplate" | "conflictCheck"
  | "calendarEvent" | "task"
  | "userPreference" | "orgPreference";

/** Lista alla entity-namn (för iteration). */
export const ENTITY_NAMES = Object.keys(ENTITY_REGISTRY) as EntityName[];
