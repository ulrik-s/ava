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

import { bytesToBase64, contentStoragePath, sha256Hex } from "@/lib/shared/content-address";
import type { DocumentId } from "@/lib/shared/schemas/ids";
import { DocumentContentCache } from "./content-cache";

export interface ContentSyncDeps {
  /** Väntande {documentId, sha}. */
  pending: () => Promise<Array<{ documentId: DocumentId; sha: string }>>;
  /** Vilka av dessa storagePaths saknar servern? */
  missing: (storagePaths: string[]) => Promise<string[]>;
  /** Cachade bytes för en sha (null = borta → hoppa). */
  getBytes: (sha: string) => Promise<Uint8Array | null>;
  /** Ladda upp bytes för ett dokument. */
  upload: (documentId: DocumentId, bytes: Uint8Array) => Promise<void>;
  /** Markera dokumentet som synkat (ta ur pending). */
  markUploaded: (documentId: DocumentId) => Promise<void>;
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
    try {
      await deps.upload(documentId, bytes);
    } catch (e) {
      // Ett dokument som inte går att ladda upp (metadatan har inte nått servern
      // än, nätfel …) ligger kvar i pending och tas nästa runda — det får inte
      // stoppa resten av kön (#1143).
      console.warn("[content-sync] upload misslyckades, försöker igen nästa synk:", documentId, e);
      continue;
    }
    await deps.markUploaded(documentId);
    uploaded.push(sha);
  }
  return uploaded;
}

/** Ett genererat dokument som ligger kvar i webbläsarens IndexedDB (`generated-doc-idb`). */
export interface LocalGeneratedDoc {
  id: string;
  bytes: Uint8Array;
}

/**
 * Räddning (#1143): genererade dokument (faktura, kostnadsräkning) sparades
 * förr BARA lokalt — innehållet nådde aldrig servern. Köa varje sådan blob för
 * upload EN gång. Redan köade hoppas över (bytes finns i cachen per sha), så en
 * senare omstart aldrig laddar upp gamla bytes över ett dokument som ändrats
 * efteråt. Icke-uuid-id översätts som legacy-id-reparationen (#1124) gör, så
 * blobben hamnar på rätt dokument.
 */
export async function queueLocalGeneratedDocs(
  docs: readonly LocalGeneratedDoc[],
  cache: DocumentContentCache,
  toDocumentId: (localId: string) => DocumentId,
): Promise<number> {
  let queued = 0;
  for (const doc of docs) {
    const sha = await sha256Hex(doc.bytes);
    if (await cache.getBytes(sha)) continue;
    await cache.cache(toDocumentId(doc.id), sha, doc.bytes);
    queued++;
  }
  return queued;
}

/** tRPC-ytan byte-synken behöver (strukturell → undviker hård klient-typ-koppling). */
export interface ContentSyncClient {
  document: {
    missingContent: { query: (input: { storagePaths: string[] }) => Promise<{ missing: string[] }> };
    uploadContent: { mutate: (input: { documentId: DocumentId; contentBase64: string }) => Promise<unknown> };
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
