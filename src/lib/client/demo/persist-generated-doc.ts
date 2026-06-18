"use client";

/**
 * `persistGeneratedDoc` — gör ett klient-genererat dokument (PDF m.fl.)
 * öppningsbart OCH persistent över tre lager, med samma kod oavsett vem som
 * genererar (kostnadsräkning, faktura, …):
 *
 *   1. in-memory blob-cache (`generated-doc-cache`) → öppnas direkt i sessionen.
 *   2. FSA-working-copy (self-hosted/demo-med-mapp) → riktiga bytes på disk.
 *   3. IndexedDB (`generated-doc-idb`) → överlever reload (rehydreras till
 *      blob-cachen vid boot). Ersätter den gamla MemFs-slaben (ADR 0016 / #420).
 *
 * Metadata-raden (Document-entiteten) skapas av anroparen via tRPC
 * (kostnadsrakning.record / document.register) — detta hanterar bara INNEHÅLLET.
 */

import { stashGeneratedDoc } from "./generated-doc-cache";
import { saveGeneratedDocBlob } from "./generated-doc-idb";

/** Skriv bytes till FSA-working-copyn om en handle finns (annars no-op). */
async function writeFsa(storagePath: string, bytes: Uint8Array): Promise<void> {
  try {
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const handle = await loadHandle("repo-root");
    if (!handle) return;
    await new FsaIsoGitAdapter(handle).writeFile("/" + storagePath, bytes);
  } catch (e) {
    console.warn("[generated-doc] FSA-skrivning misslyckades:", e);
  }
}

export interface GeneratedDoc {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function persistGeneratedDoc(doc: GeneratedDoc): Promise<void> {
  stashGeneratedDoc(doc.id, doc.bytes, doc.mimeType, doc.fileName);
  await writeFsa(doc.storagePath, doc.bytes);
  await saveGeneratedDocBlob({
    id: doc.id,
    storagePath: doc.storagePath,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    bytes: doc.bytes,
  });
}
