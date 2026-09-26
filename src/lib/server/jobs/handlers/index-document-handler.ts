/**
 * `index-document`-handler (#1215) — läser ett dokuments text per sida och
 * skriver den till serverns sökindex, UTAN att klassificera om. Används av
 * backfillen (`tooling/scripts/backfill-search-index.ts`) för dokument som
 * laddades upp innan indexet fanns: en omklassificering skulle skriva över
 * dokumenttyper som användaren rättat.
 *
 * Idempotent (sidorna ersätts). Saknat/raderat dokument → tyst no-op.
 */

import type { Document } from "@/lib/shared/schemas/document";
import type { DocumentRepository } from "../../repositories/document-repository";
import type { JobHandler } from "../job-worker-runtime";
import { classifiableFields, documentJobSchema, type PageDeps, readAndIndexPages } from "./document-text";

export interface IndexDocumentDeps extends Required<PageDeps> {
  documents: Pick<DocumentRepository, "getById">;
}

export function createIndexDocumentHandler(deps: IndexDocumentDeps): JobHandler {
  return async (job): Promise<void> => {
    const { documentId } = documentJobSchema.parse(job.data);
    const doc = (await deps.documents.getById(documentId)) as Document | null;
    if (!doc) return;
    await readAndIndexPages(deps, documentId, classifiableFields(doc));
  };
}
