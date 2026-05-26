/**
 * `prebakeJoins` — pre-bakar enkla relations-joins på en `DemoSource`
 * (matterContact.contact/matter, document/timeEntry/expense/invoice.matter)
 * + normaliserar document-datumfält.
 *
 * Delas av `demoSourceFromRuntime` (GH-Pages-demo) och
 * `hydrateWorkingCopy` (self-hosted OPFS-clone) så båda ladd-vägarna ger
 * UI:t identiskt formade objekt.
 */

import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";

interface RawMatterContact {
  id: string;
  matterId: string;
  contactId: string;
  [k: string]: unknown;
}

export function prebakeJoins(source: DemoSource): DemoSource {
  const out: DemoSource = { ...source };

  const contactsById = new Map((out.contacts ?? []).map((c) => [(c as { id: string }).id, c]));
  const mattersById = new Map((out.matters ?? []).map((m) => [(m as { id: string }).id, m]));

  if (out.matterContacts) {
    out.matterContacts = (out.matterContacts as unknown as RawMatterContact[]).map((mc) => ({
      ...mc,
      contact: contactsById.get(mc.contactId) ?? null,
      matter: mattersById.get(mc.matterId) ?? null,
    })) as readonly Record<string, unknown>[];
  }

  for (const key of ["documents", "timeEntries", "expenses", "invoices"] as const) {
    const rows = out[key];
    if (!rows) continue;
    out[key] = (rows as Array<{ matterId: string }>).map((row) => ({
      ...row,
      matter: mattersById.get(row.matterId) ?? null,
    })) as readonly Record<string, unknown>[];
  }

  if (out.documents) {
    out.documents = (out.documents as Array<Record<string, unknown>>).map((row) => {
      const uploadedAt = row.uploadedAt as Date | string | undefined;
      const createdAt = (row.createdAt as Date | string | undefined) ?? uploadedAt;
      const analysisStatus = row.analysisStatus as string | undefined;
      const isDone = analysisStatus === "COMPLETED" || analysisStatus === "DONE";
      const analyzedAt = (row.analyzedAt as Date | string | undefined) ?? (isDone ? uploadedAt : null);
      return { ...row, createdAt, analyzedAt };
    }) as readonly Record<string, unknown>[];
  }

  return out;
}
