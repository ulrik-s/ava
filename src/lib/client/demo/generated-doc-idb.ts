"use client";

/**
 * `generated-doc-idb` — persistens av klient-genererade dokument-blobbar
 * (kostnadsräkning, faktura, …) i IndexedDB.
 *
 * Bakgrund (ADR 0016 / #420): demon kör på offline-first-kärnan och ska INTE
 * längre använda MemFs-slaben. Genererade dokument har inget CDN-URL att falla
 * tillbaka på (de skapas i browsern), så för att de ska överleva en reload
 * persisterar vi bytes:erna här och rehydrerar in-memory blob-cachen
 * (`generated-doc-cache`) vid boot.
 *
 * Seed-dokument (shippade i demo-repot) berörs inte — de öppnas direkt mot
 * CDN-URL:en (se `open-document-externally.openDocumentSmart`).
 *
 * Best-effort: saknas IndexedDB (SSR/privat flik) → no-op / tom lista, precis
 * som `IndexedDbFsPersistence`. IndexedDB strukturklonar `Uint8Array` direkt,
 * så ingen base64-omkodning behövs. Egen, klient-lokal IDB-access (samma mönster
 * som `fsa/handle-store`) så inget server-lager importeras (dep-cruiser-gräns).
 */

const DB_NAME = "ava-generated-docs";
const STORE = "blobs";

export interface StoredDocBlob {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persistera (eller skriv över) en genererad dok-blob. No-op utan IndexedDB. */
export async function saveGeneratedDocBlob(blob: StoredDocBlob): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("[generated-doc] IndexedDB-spar misslyckades:", e);
  }
}

/** Alla persisterade dok-blobbar (för rehydrering vid boot). [] utan IndexedDB. */
export async function loadAllGeneratedDocBlobs(): Promise<StoredDocBlob[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    const blobs = await new Promise<StoredDocBlob[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredDocBlob[] | undefined) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return blobs;
  } catch {
    return [];
  }
}
