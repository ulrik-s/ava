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
 *   4. Upload-kön (`DocumentContentCache`, pending) → byte-synken laddar upp
 *      innehållet till servern efter nästa reconcile (server-first). Utan detta
 *      fanns bara metadatan på servern och dokumentet gick inte att öppna från
 *      en annan webbläsare (#1143). Offline-säkert: kön ligger i IndexedDB.
 *
 * Metadata-raden (Document-entiteten) skapas av anroparen via tRPC
 * (kostnadsrakning.record / document.register) — detta hanterar bara INNEHÅLLET.
 */

import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { sha256Hex } from "@/lib/shared/content-address";
import { asId } from "@/lib/shared/schemas/ids";
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

/** Lägg bytes i upload-kön (no-op utan IndexedDB, t.ex. i SSR/tester). */
async function queueUpload(doc: GeneratedDoc): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const cache = new DocumentContentCache();
    await cache.cache(asId<"DocumentId">(doc.id), await sha256Hex(doc.bytes), doc.bytes);
  } catch (e) {
    // Bytes finns kvar i generated-doc-idb (steg 3) → räddningen vid nästa start köar dem.
    console.warn("[generated-doc] kunde inte köa upload:", e);
  }
}

export async function persistGeneratedDoc(doc: GeneratedDoc): Promise<void> {
  stashGeneratedDoc(doc.id, doc.bytes, doc.mimeType, doc.fileName);
  await queueUpload(doc);
  await writeFsa(doc.storagePath, doc.bytes);
  await saveGeneratedDocBlob({
    id: doc.id,
    storagePath: doc.storagePath,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    bytes: doc.bytes,
  });
}
