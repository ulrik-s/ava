/**
 * Delat för dokumentjobben (#518, #1215): jobb-payloaden, dokumentfälten som
 * behövs för att läsa bytes, och steget "läs sidorna EN gång + indexera dem".
 * Klassificering, taggförslag och kontakt-/händelseförslag återanvänder sedan
 * samma text — tidigare extraherades PDF:en upp till tre gånger per jobb.
 */

import { z } from "zod";
import type { Document } from "@/lib/shared/schemas/document";
import { type DocumentId, documentIdSchema, organizationIdSchema } from "@/lib/shared/schemas/ids";
import type { IDocumentPageIndex } from "../../ports";

/** Payload för `classify-document` och `index-document`. */
export const documentJobSchema = z.object({
  documentId: documentIdSchema,
  organizationId: organizationIdSchema.optional(),
});

/** Dokument-fälten jobben behöver (filnamn + var bytes ligger). */
export interface ClassifiableDoc {
  fileName: string;
  storagePath: string;
  mimeType: string;
}

export function classifiableFields(doc: Document): ClassifiableDoc {
  return { fileName: doc.fileName, storagePath: doc.storagePath, mimeType: doc.mimeType };
}

/** Hur sidorna läses och vart de indexeras. */
export interface PageDeps {
  /** Läs dokumentets text per sida (bytes ur content-store:n). Saknas → ingen text server-side. */
  readPages?: (doc: ClassifiableDoc) => Promise<string[]>;
  /** Serverns sidindex (#1215). Saknas → sidorna skrivs inte. */
  pageIndex?: IDocumentPageIndex;
}

/**
 * Läs sidorna en gång och ersätt dokumentets sidor i indexet. Utan `readPages`
 * finns ingen text att läsa → indexet rörs inte (tomt resultat).
 */
export async function readAndIndexPages(deps: PageDeps, documentId: DocumentId, doc: ClassifiableDoc): Promise<string[]> {
  if (!deps.readPages) return [];
  const pages = await deps.readPages(doc);
  await deps.pageIndex?.replacePages(documentId, pages);
  return pages;
}
