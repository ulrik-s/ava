/**
 * `demoSourceFromRuntime` — adapter som översätter `DemoRuntime`:s
 * hydratiserade entiteter till en `DemoSource` som `DemoDataStore`
 * konsumerar.
 *
 * Designval (Adapter pattern):
 *   - Ena sidan vet inget om den andra. Adaptern är thunk-baserad så
 *     `DemoDataStore` får färska arrayer när DemoRuntime laddar om.
 *
 * Designval (Open-closed):
 *   - När fler projektioner läggs till i `buildDefaultRegistry` räcker
 *     det att utöka mappnings-tabellen här.
 */

import type { DemoRuntime } from "@/server/local-first/demo-runtime";
import type { DemoSource } from "@/server/data-store/DemoDataStore";

/** Projection-namn → DemoSource-fält. */
const ENTITY_TO_SOURCE_KEY: Record<string, keyof DemoSource> = {
  matter: "matters",
  contact: "contacts",
  user: "users",
  document: "documents",
  invoice: "invoices",
  timeEntry: "timeEntries",
  expense: "expenses",
  organization: "organizations",
  office: "offices",
  documentTemplate: "documentTemplates",
};

export function demoSourceFromRuntime(runtime: DemoRuntime): DemoSource {
  const entities = runtime.allEntities();
  const out: DemoSource = {};
  for (const [entity, list] of Object.entries(entities)) {
    const key = ENTITY_TO_SOURCE_KEY[entity];
    if (!key) continue;
    (out as Record<string, readonly unknown[]>)[key] = list;
  }
  return out;
}
