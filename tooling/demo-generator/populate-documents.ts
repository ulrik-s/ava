/**
 * `populateDocuments` — registrerar dokument-metadata via tRPC
 * (`document.register`) OCH genererar de riktiga binärfilerna (PDF/DOCX)
 * via `generateDocumentBytes`.
 *
 * Hybrid: metadatan går genom API:t (samma kontrakt för git/Postgres), men
 * själva filinnehållet är backend-specifikt (git → bytes till
 * `documents/content/…` via `sink`; Postgres → storage, ej impl än). Utan
 * `sink` registreras bara metadata (test/metadata-only).
 *
 * Ordning: generera bytes → faktisk storlek → register(med sizeBytes) →
 * skriv binär. (Speglar `seed-firma-local`.)
 */

import { generateDocumentBytes } from "../scripts/seed-data";
import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCaller = any;

/** Skriver en binärfil till backend-storage. Returnerar faktisk storlek. */
export type BinarySink = (storagePath: string, bytes: Uint8Array) => number;

function defined(obj: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function iso(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function populateDocuments(caller: GeneratorCaller, seed: SeedDataset, sink?: BinarySink): Promise<number> {
  const c = caller as AnyCaller;
  const docs = (seed.documents as Row[] | undefined) ?? [];
  for (const d of docs) {
    let size = Number(d.sizeBytes ?? 0);
    const storagePath = d.storagePath ? String(d.storagePath) : undefined;
    if (sink && storagePath) {
      const bytes = await generateDocumentBytes(d as Parameters<typeof generateDocumentBytes>[0]);
      size = sink(storagePath, bytes);
    }
    await c.document.register(
      defined({ id: d.id, matterId: d.matterId, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: size, storagePath, folderId: d.folderId, uploadedById: d.uploadedById, version: d.version, title: d.title, documentType: d.documentType, summary: d.summary, analysisStatus: d.analysisStatus, analyzedAt: iso(d.analyzedAt), createdAt: iso(d.createdAt) }),
    );
  }
  return docs.length;
}
