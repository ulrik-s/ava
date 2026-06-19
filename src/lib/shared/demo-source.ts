/**
 * `DemoSource` + `prebakeJoins` — det ramverks-agnostiska data-formatet som
 * `DemoDataStore` konsumerar, plus join-prebakningen som alla ladd-vägar delar.
 *
 * Bor i `shared/` (inte `client/` eller `server/`) eftersom BÅDE browser-
 * runtimen (OPFS-clone, GH-Pages-demo) OCH server-runtimen (#77, node-fs
 * working copy) bygger en `DemoSource` och behöver `prebakeJoins`. Lager-
 * regeln `ui-imports-server-by-type-only` förbjuder klienten att värde-
 * importera server-kod, och `shared-must-not-import-up` förbjuder shared att
 * importera server — så det enda lagret som kan ägas av båda är `shared`.
 *
 * Innehåller ingen ramverkskod (react/next/trpc) → uppfyller
 * `shared-must-be-framework-agnostic`.
 */

import { synthesizeBadDebtWriteOffs } from "./write-off-migration";

/** Demo-data per entitet. Saknade entiteter får tom array. */
export interface DemoSource {
  matters?: readonly Record<string, unknown>[];
  matterContacts?: readonly Record<string, unknown>[];
  contacts?: readonly Record<string, unknown>[];
  documents?: readonly Record<string, unknown>[];
  documentFolders?: readonly Record<string, unknown>[];
  documentTemplates?: readonly Record<string, unknown>[];
  documentAnalysisSuggestions?: readonly Record<string, unknown>[];
  matterEventSuggestions?: readonly Record<string, unknown>[];
  invoices?: readonly Record<string, unknown>[];
  timeEntries?: readonly Record<string, unknown>[];
  expenses?: readonly Record<string, unknown>[];
  users?: readonly Record<string, unknown>[];
  organizations?: readonly Record<string, unknown>[];
  offices?: readonly Record<string, unknown>[];
  conflictChecks?: readonly Record<string, unknown>[];
  payments?: readonly Record<string, unknown>[];
  paymentPlans?: readonly Record<string, unknown>[];
  paymentPlanReminders?: readonly Record<string, unknown>[];
  accontoDeductions?: readonly Record<string, unknown>[];
  billingRuns?: readonly Record<string, unknown>[];
  writeOffs?: readonly Record<string, unknown>[];
  invoiceDispatches?: readonly Record<string, unknown>[];
  expectedReceivables?: readonly Record<string, unknown>[];
  calendarEvents?: readonly Record<string, unknown>[];
  tasks?: readonly Record<string, unknown>[];
  serviceNotes?: readonly Record<string, unknown>[];
  userPreferences?: readonly Record<string, unknown>[];
  orgPreferences?: readonly Record<string, unknown>[];
}

/**
 * Pre-baka enkla relations-joins på en `DemoSource`
 * (matterContact.contact/matter, document/timeEntry/expense/invoice.matter)
 * + normalisera document-datumfält. Görs en gång vid laddning så routrarnas
 * `include: { contact: ... }` ger korrekta nästlade fält utan att
 * InMemoryQueryEngine behöver rekursiv hydrate.
 */
export function prebakeJoins(source: DemoSource): DemoSource {
  const out: DemoSource = { ...source };

  const contactsById = new Map((out.contacts ?? []).map((c) => [(c as { id: string }).id, c]));
  const mattersById = new Map((out.matters ?? []).map((m) => [(m as { id: string }).id, m]));

  if (out.matterContacts) {
    out.matterContacts = out.matterContacts.map((mc) => ({
      ...mc,
      contact: contactsById.get(mc.contactId as string) ?? null,
      matter: mattersById.get(mc.matterId as string) ?? null,
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

  applyBadDebtWriteOffMigration(out);
  return out;
}

/**
 * Migrate-on-read (ADR 0007): ge legacy-BAD_DEBT-fakturor en daterad WriteOff.
 * Idempotent — hoppar fakturor som redan har en (inkl. seedens explicita).
 */
function applyBadDebtWriteOffMigration(out: DemoSource): void {
  const synthetic = synthesizeBadDebtWriteOffs(out.invoices ?? [], out.payments ?? [], out.writeOffs ?? []);
  if (synthetic.length) {
    out.writeOffs = [...(out.writeOffs ?? []), ...synthetic] as readonly Record<string, unknown>[];
  }
}
