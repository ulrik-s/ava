/**
 * `demoSourceFromRuntime` — adapter som översätter `DemoRuntime`:s
 * hydratiserade entiteter till en `DemoSource` som `DemoDataStore`
 * konsumerar.
 *
 * Pre-bakar enkla joins (matterContact.contact, matterContact.matter,
 * document.matter etc.) så routrarnas `include: { contact: ... }` ger
 * korrekta nästlade fält utan att InMemoryQueryEngine behöver
 * implementera rekursiv hydrate.
 */

import type { DemoRuntime } from "@/lib/server/local-first/demo-runtime";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { prebakeJoins } from "./prebake-joins";

/** Projection-namn → DemoSource-fält. */
const ENTITY_TO_SOURCE_KEY: Record<string, keyof DemoSource> = {
  matter: "matters",
  contact: "contacts",
  user: "users",
  matterContact: "matterContacts",
  document: "documents",
  invoice: "invoices",
  timeEntry: "timeEntries",
  expense: "expenses",
  organization: "organizations",
  office: "offices",
  documentTemplate: "documentTemplates",
  // Tillagda: tidigare hydraterades dessa inte → kalender, avbetalningar,
  // tasks och jävskontroller visade tomma listor i demon.
  calendarEvent: "calendarEvents",
  paymentPlan: "paymentPlans",
  payment: "payments",
  paymentPlanReminder: "paymentPlanReminders",
  task: "tasks",
  conflictCheck: "conflictChecks",
};

export function demoSourceFromRuntime(runtime: DemoRuntime): DemoSource {
  const entities = runtime.allEntities();
  const out: DemoSource = {};
  for (const [entity, list] of Object.entries(entities)) {
    const key = ENTITY_TO_SOURCE_KEY[entity];
    if (!key) continue;
    (out as Record<string, readonly unknown[]>)[key] = list;
  }
  return prebakeJoins(out);
}
