/**
 * Backfill av dokumentens typer (ADR 0038) — körs när servern startat.
 *
 * Migration 0049 lade bara till kolumnerna. Här flyttas typerna från de äldre
 * fälten (`documentType`, `tags`, delarna) till `kinds`, och byråns
 * taggvokabulär till `documentKinds`. Det sker EFTER omstarten: då är den
 * gamla servern stoppad, så även rader den hann skriva efter migrationen kommer
 * med.
 *
 * Skrivningarna går via repona (`updateMetadata`/`update`), som loggar i
 * `change_log` → klienterna hämtar raderna vid nästa pull (ADR 0017).
 * Idempotent: körs vid varje start, och hittar då bara rader som äldre kod
 * (eller en äldre klient) skrivit. Fel loggas per rad; läsregeln
 * (`documentKinds`) täcker det som inte hann flyttas.
 */

import { kindsFields, legacyKinds, legacyKindsManual, organizationKinds } from "@/lib/shared/document-kinds";
import type { Document } from "@/lib/shared/schemas/document";
import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { DocumentPartRepository } from "../repositories/document-part-repository";
import type { DocumentRepository } from "../repositories/document-repository";
import type { OrganizationRepository } from "../repositories/organization-repository";

export interface KindsBackfillDeps {
  documents: Pick<DocumentRepository, "listWithLegacyKinds" | "updateMetadata">;
  documentParts: Pick<DocumentPartRepository, "listForDocument">;
  organizations: Pick<OrganizationRepository, "getById" | "update">;
}

export interface KindsBackfillResult {
  documents: number;
  organizations: number;
  failed: number;
}

/** Ett dokument: typerna ur de äldre fälten → `kinds`. */
async function backfillDocument(deps: KindsBackfillDeps, doc: Document): Promise<void> {
  const parts = await deps.documentParts.listForDocument(doc.id);
  const kinds = legacyKinds({ documentType: doc.documentType, tags: doc.tags, parts });
  const manual = legacyKindsManual({ documentType: doc.documentType, fileName: doc.fileName, analysisModel: doc.analysisModel, parts });
  await deps.documents.updateMetadata(doc.id, kindsFields(kinds, manual));
}

/** En lagrad lista — rader från äldre data (eller utan databasens default) kan sakna fältet. */
const storedList = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/** En byrå: taggvokabulärens egna typer → `documentKinds` (taggarna töms). */
async function backfillOrganization(deps: KindsBackfillDeps, id: OrganizationId): Promise<boolean> {
  const org = await deps.organizations.getById(id);
  if (!org || storedList(org.documentKinds).length > 0 || storedList(org.documentTags).length === 0) return false;
  await deps.organizations.update(id, { documentKinds: organizationKinds(org), documentTags: [] });
  return true;
}

/** Kör `run`; ett fel räknas och loggas i stället för att kastas. */
async function attempt<T>(result: KindsBackfillResult, label: string, run: () => Promise<T>, fallback: T, onError: (m: string) => void): Promise<T> {
  try {
    return await run();
  } catch (err) {
    result.failed++;
    onError(`${label}: ${String(err)}`);
    return fallback;
  }
}

/** Flytta allt som bara har typer i de äldre fälten. Kastar aldrig. */
export async function backfillDocumentKinds(
  deps: KindsBackfillDeps, organizationIds: readonly OrganizationId[], onError: (message: string) => void,
): Promise<KindsBackfillResult> {
  const result: KindsBackfillResult = { documents: 0, organizations: 0, failed: 0 };
  for (const id of organizationIds) {
    if (await attempt(result, `byrå ${id}`, () => backfillOrganization(deps, id), false, onError)) result.organizations++;
  }
  const docs = await attempt(result, "dokumentlistan", () => deps.documents.listWithLegacyKinds(), [], onError);
  for (const doc of docs) {
    const ok = await attempt(result, `dokument ${doc.id}`, async () => { await backfillDocument(deps, doc); return true; }, false, onError);
    if (ok) result.documents++;
  }
  return result;
}
