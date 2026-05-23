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

import type { DemoRuntime } from "@/server/local-first/demo-runtime";
import type { DemoSource } from "@/server/data-store/DemoDataStore";

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
};

interface RawMatterContact {
  id: string;
  matterId: string;
  contactId: string;
  role?: string;
  notes?: string | null;
  createdAt?: Date | string;
}

export function demoSourceFromRuntime(runtime: DemoRuntime): DemoSource {
  const entities = runtime.allEntities();
  const out: DemoSource = {};
  for (const [entity, list] of Object.entries(entities)) {
    const key = ENTITY_TO_SOURCE_KEY[entity];
    if (!key) continue;
    (out as Record<string, readonly unknown[]>)[key] = list;
  }

  // Pre-bake joins så `include: { contact: {...} }` på matterContact
  // ger tillbaka nästade objekt direkt.
  const contactsById = new Map(
    (out.contacts ?? []).map((c) => [(c as { id: string }).id, c]),
  );
  const mattersById = new Map(
    (out.matters ?? []).map((m) => [(m as { id: string }).id, m]),
  );
  if (out.matterContacts) {
    out.matterContacts = (out.matterContacts as unknown as RawMatterContact[]).map((mc) => ({
      ...mc,
      contact: contactsById.get(mc.contactId) ?? null,
      matter: mattersById.get(mc.matterId) ?? null,
    })) as readonly Record<string, unknown>[];
  }
  // Pre-bake document.matter, timeEntry.matter, expense.matter, invoice.matter
  for (const key of ["documents", "timeEntries", "expenses", "invoices"] as const) {
    const rows = out[key];
    if (!rows) continue;
    out[key] = (rows as Array<{ matterId: string }>).map((row) => ({
      ...row,
      matter: mattersById.get(row.matterId) ?? null,
    })) as readonly Record<string, unknown>[];
  }

  // Document-projection-schemat heter `uploadedAt` men UI:n läser
  // `createdAt`. Mappa fallback så datum-stämpeln blir synlig.
  // Likadant: analyzedAt = uploadedAt om analysen var klar (analysisStatus
  // = COMPLETED/DONE) men ingen analyzedAt-fält finns i seed-datan.
  if (out.documents) {
    out.documents = (out.documents as Array<Record<string, unknown>>).map((row) => {
      const uploadedAt = row.uploadedAt as Date | string | undefined;
      const createdAt = (row.createdAt as Date | string | undefined) ?? uploadedAt;
      const analysisStatus = row.analysisStatus as string | undefined;
      const isDone = analysisStatus === "COMPLETED" || analysisStatus === "DONE";
      const analyzedAt = (row.analyzedAt as Date | string | undefined)
        ?? (isDone ? uploadedAt : null);
      return { ...row, createdAt, analyzedAt };
    }) as readonly Record<string, unknown>[];
  }

  return out;
}
