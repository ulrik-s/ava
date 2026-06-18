/**
 * `pathToSourceKey` — mappar en repo-relativ fil-path till sin `DemoSource`-
 * nyckel (plural). Detta är den path→entitet-mappning som projection-registret
 * tidigare ägde (`buildDefaultRegistry`s `ownsPath`-predikat + `ENTITY_TO_SOURCE_KEY`),
 * nu fristående och direkt mot DemoSource — eftersom demon (ADR 0016, #420) bygger
 * en `DemoSource` direkt ur de fetchade filerna utan MemFs/projektion-hydrering.
 *
 * Open-closed: ny entitet = en ny rad i `MATCHERS`. Ordningen spelar roll —
 * mer specifika predikat (documents-undantag) måste komma före de generella.
 */

import type { DemoSource } from "@/lib/shared/demo-source";

interface Matcher {
  key: keyof DemoSource;
  owns: (path: string) => boolean;
}

/** Registreringsordning = matchnings-ordning (specifika predikat först). */
const MATCHERS: Matcher[] = [
  { key: "matters", owns: (p) => p.startsWith("matters/") },
  { key: "contacts", owns: (p) => p.startsWith("contacts/") },
  { key: "users", owns: (p) => p.startsWith(".ava/users/") },
  { key: "matterContacts", owns: (p) => p.startsWith("matter-contacts/") },
  {
    key: "documents",
    owns: (p) => p.startsWith("documents/") && !p.startsWith("documents/content/") && !p.startsWith("documents/text/"),
  },
  { key: "timeEntries", owns: (p) => p.startsWith("time-entries/") },
  { key: "expenses", owns: (p) => p.startsWith("expenses/") },
  { key: "invoices", owns: (p) => p.startsWith("invoices/") },
  { key: "calendarEvents", owns: (p) => p.startsWith("calendar/") },
  { key: "paymentPlans", owns: (p) => p.startsWith("payment-plans/") },
  { key: "payments", owns: (p) => p.startsWith("payments/") },
  { key: "paymentPlanReminders", owns: (p) => p.startsWith("payment-plan-reminders/") },
  { key: "billingRuns", owns: (p) => p.startsWith("billing-runs/") },
  { key: "accontoDeductions", owns: (p) => p.startsWith("acconto-deductions/") },
  { key: "expectedReceivables", owns: (p) => p.startsWith("expected-receivables/") },
  { key: "tasks", owns: (p) => p.startsWith("tasks/") },
  { key: "conflictChecks", owns: (p) => p.startsWith("conflict-checks/") },
  { key: "documentTemplates", owns: (p) => p.startsWith(".ava/templates/") },
  { key: "organizations", owns: (p) => p.startsWith(".ava/organizations/") },
  { key: "offices", owns: (p) => p.startsWith("offices/") },
  { key: "userPreferences", owns: (p) => p.startsWith(".ava/user-preferences/") },
  { key: "orgPreferences", owns: (p) => p.startsWith(".ava/org-preferences/") },
];

/** Returnera `DemoSource`-nyckeln en path hör till, eller `null` om ingen. */
export function pathToSourceKey(path: string): keyof DemoSource | null {
  for (const m of MATCHERS) {
    if (m.owns(path)) return m.key;
  }
  return null;
}
