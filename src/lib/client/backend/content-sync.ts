"use client";

/**
 * Byte-synk (#518, ADR 0023) — vid reconnect: ladda upp de content-adresserade
 * blobbar som servern saknar. Skild kanal från entitets-mutation-kön (som bara
 * bär metadatan `storagePath`); byte:sen rider INTE med i den.
 *
 * `runContentSync` är ren + dep-injicerad (testbar utan IndexedDB/tRPC).
 * `syncDocumentContent` wirar den mot tRPC-klienten + `DocumentContentCache`.
 *
 * Dedup: frågar `missingContent` först → laddar bara upp sha:n servern saknar.
 * Coalesce: pending-manifestet är keyat på documentId → bara senaste versionen.
 */

import { bytesToBase64, contentStoragePath } from "@/lib/shared/content-address";
import { DocumentContentCache } from "./content-cache";

export interface ContentSyncDeps {
  /** Väntande {documentId, sha}. */
  pending: () => Promise<Array<{ documentId: string; sha: string }>>;
  /** Vilka av dessa storagePaths saknar servern? */
  missing: (storagePaths: string[]) => Promise<string[]>;
  /** Cachade bytes för en sha (null = borta → hoppa). */
  getBytes: (sha: string) => Promise<Uint8Array | null>;
  /** Ladda upp bytes för ett dokument. */
  upload: (documentId: string, bytes: Uint8Array) => Promise<void>;
  /** Markera dokumentet som synkat (ta ur pending). */
  markUploaded: (documentId: string) => Promise<void>;
}

/** Ladda upp saknade blobbar. Returnerar sha:n som faktiskt laddades upp. */
export async function runContentSync(deps: ContentSyncDeps): Promise<string[]> {
  const pend = await deps.pending();
  if (pend.length === 0) return [];
  const missing = new Set(await deps.missing(pend.map((p) => contentStoragePath(p.sha))));
  const uploaded: string[] = [];
  for (const { documentId, sha } of pend) {
    if (!missing.has(contentStoragePath(sha))) { await deps.markUploaded(documentId); continue; }
    const bytes = await deps.getBytes(sha);
    if (!bytes) { await deps.markUploaded(documentId); continue; }
    await deps.upload(documentId, bytes);
    await deps.markUploaded(documentId);
    uploaded.push(sha);
  }
  return uploaded;
}

/** tRPC-ytan byte-synken behöver (strukturell → undviker hård klient-typ-koppling). */
export interface ContentSyncClient {
  document: {
    missingContent: { query: (input: { storagePaths: string[] }) => Promise<{ missing: string[] }> };
    uploadContent: { mutate: (input: { documentId: string; contentBase64: string }) => Promise<unknown> };
  };
}

/** Wira `runContentSync` mot tRPC-klienten + byte-cachen. */
export function syncDocumentContent(
  client: ContentSyncClient,
  cache: DocumentContentCache = new DocumentContentCache(),
): Promise<string[]> {
  return runContentSync({
    pending: () => cache.pendingUploads(),
    missing: async (paths) => (await client.document.missingContent.query({ storagePaths: paths })).missing,
    getBytes: (sha) => cache.getBytes(sha),
    upload: async (documentId, bytes) => {
      await client.document.uploadContent.mutate({ documentId, contentBase64: bytesToBase64(bytes) });
    },
    markUploaded: (documentId) => cache.markUploaded(documentId),
  });
}
