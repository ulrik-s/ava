/**
 * Kanonisk mappning **DemoSource-nyckel (plural) ↔ projektions-entitetsnamn
 * (singular)** — en sanningskälla (DRY) som både `LocalStore.entityNameFor`
 * (write-back-tagging) och reconcile-apply i `CachingSyncDataStore` (#415)
 * använder.
 *
 * `MutationEvent.entity` och `PulledChange.entity` (ADR 0017) är SINGULAR
 * (`"matter"`, `"invoice"`); `DemoSource`-arrayerna är PLURAL (`matters`,
 * `invoices`). Reconcile-motorn skriver kanoniska rader per *entity* (singular)
 * → vi måste slå upp rätt source-array (plural) för att applicera dem.
 */

/** plural source-nyckel → singular entitetsnamn. */
export const ENTITY_NAME_BY_SOURCE_KEY: Record<string, string> = {
  matters: "matter",
  contacts: "contact",
  matterContacts: "matterContact",
  documents: "document",
  documentFolders: "documentFolder",
  documentTemplates: "documentTemplate",
  documentAnalysisSuggestions: "documentAnalysisSuggestion",
  matterEventSuggestions: "matterEventSuggestion",
  timeEntries: "timeEntry",
  expenses: "expense",
  invoices: "invoice",
  users: "user",
  organizations: "organization",
  offices: "office",
  conflictChecks: "conflictCheck",
  payments: "payment",
  writeOffs: "writeOff",
  invoiceDispatches: "invoiceDispatch",
  expectedReceivables: "expectedReceivable",
  paymentPlans: "paymentPlan",
  paymentPlanReminders: "paymentPlanReminder",
  accontoDeductions: "accontoDeduction",
  billingRuns: "billingRun",
  calendarEvents: "calendarEvent",
  tasks: "task",
  serviceNotes: "serviceNote",
  userPreferences: "userPreference",
  orgPreferences: "orgPreference",
};

/** singular entitetsnamn → plural source-nyckel (invers av ovan). */
export const SOURCE_KEY_BY_ENTITY: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_NAME_BY_SOURCE_KEY).map(([sourceKey, entity]) => [entity, sourceKey]),
);
