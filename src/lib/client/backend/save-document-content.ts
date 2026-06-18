"use client";

/**
 * `saveDocumentContent` (#518, ADR 0023) — spara-primitiv: cacha dokument-bytes
 * (content-adresserat, markerat pending) + ladda upp via `document.uploadContent`
 * (servern content-adresserar + repekar `storagePath`).
 *
 * Online: uploadContent når servern direkt. Offline: mutationen körs in-process
 * (köas) och blobben ligger pending i cachen → byte-synken (`syncDocumentContent`)
 * laddar upp den vid reconnect. Samma skriv-väg oavsett.
 */

import { bytesToBase64, sha256Hex } from "@/lib/shared/content-address";
import { DocumentContentCache } from "./content-cache";

/** tRPC-ytan primitiven behöver (strukturell). */
export interface UploadClient {
  document: {
    uploadContent: { mutate: (input: { documentId: string; contentBase64: string }) => Promise<unknown> };
  };
}

export async function saveDocumentContent(
  client: UploadClient,
  documentId: string,
  bytes: Uint8Array,
  cache: DocumentContentCache = new DocumentContentCache(),
): Promise<string> {
  const sha = await sha256Hex(bytes);
  await cache.cache(documentId, sha, bytes); // blob + pending (offline-säkert)
  await client.document.uploadContent.mutate({ documentId, contentBase64: bytesToBase64(bytes) });
  return sha;
}
