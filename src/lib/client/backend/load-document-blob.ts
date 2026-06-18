"use client";

/**
 * `loadDocumentBlob` (#518, ADR 0023) — öppna-primitiv för server-first:
 * hämta dokument-bytes som `Blob` ur byte-cachen (hit) eller via
 * `document.downloadContent` (miss → cacha). Ersätter den borttagna
 * FSA-working-copy-läsningen. Cachen är content-adresserad → immutabel.
 */

import { base64ToBytes } from "@/lib/shared/content-address";
import { DocumentContentCache } from "./content-cache";

/** tRPC-ytan primitiven behöver (strukturell → ingen hård klient-typ-koppling). */
export interface DownloadClient {
  document: {
    downloadContent: {
      query: (input: { documentId: string }) => Promise<{ contentBase64: string; mimeType: string }>;
    };
  };
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

function mimeFromName(fileName: string): string {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Cache-nyckel ur storagePath (sista segmentet = sha, content-adresserat). */
function cacheKey(doc: { id: string; storagePath?: string | null }): string {
  return doc.storagePath?.split("/").pop() ?? doc.id;
}

export async function loadDocumentBlob(
  client: DownloadClient,
  doc: { id: string; storagePath?: string | null; fileName: string },
  cache: DocumentContentCache = new DocumentContentCache(),
): Promise<Blob | null> {
  const key = cacheKey(doc);
  const cached = await cache.getBytes(key);
  if (cached) return new Blob([cached as BlobPart], { type: mimeFromName(doc.fileName) });
  try {
    const res = await client.document.downloadContent.query({ documentId: doc.id });
    const bytes = base64ToBytes(res.contentBase64);
    await cache.putBytes(key, bytes);
    return new Blob([bytes as BlobPart], { type: res.mimeType || mimeFromName(doc.fileName) });
  } catch {
    return null; // download misslyckades (offline + ej cachad, eller saknas)
  }
}
