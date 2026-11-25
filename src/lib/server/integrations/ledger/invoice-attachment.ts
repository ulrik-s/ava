/**
 * `invoicePdfAttachment` — fakturans PDF som bilaga till verifikatet (#1887).
 *
 * Fakturans PDF sparas som ett dokument med fakturans `invoiceId` (klienten
 * genererar och laddar upp den). Bokföringen hämtar den härifrån och bifogar
 * den, så att byråns ekonom och revisor har underlaget i bokföringssystemet.
 *
 * Funktionen kastar när det inte finns någon PDF att bifoga. Drivrutinen
 * (`bookUnbookedInvoices`) fångar det som `attachmentError`: en saknad bilaga
 * stoppar aldrig bokföringen (#1885). Skälen innehåller aldrig filnamn eller
 * innehåll, eftersom de loggas.
 */

import { isDocumentStoragePath } from "@/lib/shared/document-storage-path";
import type { Document } from "@/lib/shared/schemas/document";
import type { IContentStore } from "../../ports";
import type { LedgerAttachment } from "./port";

const PDF = "application/pdf";

/** Det bilagan behöver av ett dokument. `deletedAt` finns på raden men inte i schemat. */
type InvoiceDocument = Pick<Document, "fileName" | "mimeType" | "storagePath" | "createdAt"> & {
  deletedAt?: unknown;
};

/** En PDF med giltig sökväg som inte är mjukt raderad (`getByIdFull` filtrerar inte bort dem). */
function isAttachablePdf(doc: InvoiceDocument): boolean {
  return doc.mimeType === PDF && isDocumentStoragePath(doc.storagePath) && doc.deletedAt == null;
}

/** Den nyaste bifogningsbara PDF:en, eller `undefined`. Äldre fakturor i HTML hoppas över. */
function newestInvoicePdf<D extends InvoiceDocument>(documents: readonly D[]): D | undefined {
  return documents
    .filter(isAttachablePdf)
    .reduce<D | undefined>((newest, doc) => (newest && newest.createdAt >= doc.createdAt ? newest : doc), undefined);
}

/** Fakturans PDF som bilaga; kastar med ett skäl (utan filnamn) när den saknas. */
export async function invoicePdfAttachment(
  content: Pick<IContentStore, "read">,
  documents: readonly InvoiceDocument[],
): Promise<LedgerAttachment> {
  const doc = newestInvoicePdf(documents);
  if (!doc) throw new Error("Fakturan har ingen PDF att bifoga.");
  const bytes = await content.read(doc.storagePath);
  if (!bytes) throw new Error("Fakturans PDF saknas på servern.");
  return { fileName: doc.fileName, bytes, contentType: PDF };
}
