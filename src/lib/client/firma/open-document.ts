"use client";

/**
 * `openDocument` — bestämmer hur ett dokument ska öppnas baserat på
 * deploy-mode (demo / self-hosted / fallback).
 *
 * Pure (allt externt injicerat) så testning slipper FSA-mocks. Branscher:
 *
 *   1. Demo (gh-pages): öppna direkt mot `<repo>/<storagePath>` — filerna
 *      ligger i samma demo-repo som AVA:n.
 *   2. Self-hosted: läs `storagePath` från lokal working copy (FSA/OPFS),
 *      skapa blob:URL, öppna i ny flik.
 *   3. Annars: visa felmeddelande (filsystemet saknas, dokumentet finns ej).
 */

export interface OpenDocumentDeps {
  doc: { id: string; storagePath?: string | null; fileName?: string };
  /** Demo-flagga från env. Bygg-tid: NEXT_PUBLIC_DEMO_BUILD === "1". */
  isDemo: boolean;
  /** "user/repo" för demo. Ignoreras i självhostad. */
  demoRepo?: string;
  /** Returnerar working-copy-handle eller null om saknas. */
  loadHandle: () => Promise<FileSystemDirectoryHandle | null>;
  /** FSA-läsare; default-implementationen är samma som `_document-row`. */
  readFromHandle: (handle: FileSystemDirectoryHandle, path: string) => Promise<Blob | null>;
  /** Öppnar URL i ny flik (injicerbar för test). */
  openUrl: (url: string) => void;
  /** Visar fel till användaren (injicerbar för test). */
  notifyError: (msg: string) => void;
  /**
   * Server-first (#518): hämta dokument-bytes från servern (+ klient-cache) i
   * st.f. den borttagna FSA-working-copyn. Sätts → används före FSA-vägen.
   */
  fetchBlob?: () => Promise<Blob | null>;
}

/** Öppna en blob i ny flik (charset-taggad för text). Revoke efter 60 s. */
function openBlobUrl(blob: Blob, storagePath: string, openUrl: (url: string) => void): void {
  const url = URL.createObjectURL(withUtf8CharsetIfText(blob, storagePath));
  openUrl(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openDocument(deps: OpenDocumentDeps): Promise<"opened-gh-pages" | "opened-blob" | "opened-generated" | "error"> {
  const { doc, isDemo, demoRepo, openUrl, notifyError, fetchBlob } = deps;
  const storagePath = doc.storagePath ?? `documents/${doc.id}`;

  // Demo + self-hosted: dokument som genererats client-side under denna
  // session finns INTE som statisk fil — slå upp i in-memory blob-cachen
  // först. (Kostnadsräkning m.fl.)
  const { hasGeneratedDoc, openGeneratedDoc } = await import("@/lib/client/demo/generated-doc-cache");
  if (hasGeneratedDoc(doc.id)) {
    openGeneratedDoc(doc.id, (url) => openUrl(url));
    return "opened-generated";
  }

  if (isDemo) {
    const repo = demoRepo ?? "ulrik-s/ava-demo";
    const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
    const base = m ? `https://${m[1]}.github.io/${m[2]}` : repo.replace(/\/+$/, "");
    openUrl(`${base}/${storagePath}`);
    return "opened-gh-pages";
  }

  // Server-first (#518): hämta bytes från servern (+ klient-cache). Före FSA.
  if (fetchBlob) {
    const blob = await fetchBlob();
    if (!blob) { notifyError(`Dokumentet kunde inte hämtas (${storagePath}).`); return "error"; }
    openBlobUrl(blob, storagePath, openUrl);
    return "opened-blob";
  }

  return openFromFsa(deps, storagePath);
}

/** Öppna ur den lokala FSA-working-copyn (legacy git-first-vägen). */
async function openFromFsa(deps: OpenDocumentDeps, storagePath: string): Promise<"opened-blob" | "error"> {
  const { loadHandle, readFromHandle, openUrl, notifyError } = deps;
  const handle = await loadHandle();
  if (!handle) {
    notifyError("Ingen working copy är ansluten — anslut via /settings.");
    return "error";
  }
  const blob = await readFromHandle(handle, storagePath);
  if (!blob) {
    notifyError(`Dokumentet kunde inte hittas på disk (${storagePath}).`);
    return "error";
  }
  openBlobUrl(blob, storagePath, openUrl);
  return "opened-blob";
}

/**
 * Returnerar samma blob med rätt MIME-type. För text-baserade format
 * (.md, .txt, .csv, .json, .html) tvingar vi `; charset=utf-8` så
 * Safari/Chrome renderar svenska tecken korrekt.
 */
export function withUtf8CharsetIfText(blob: Blob, storagePath: string): Blob {
  const lower = storagePath.toLowerCase();
  const textExt: Record<string, string> = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".xml": "application/xml",
  };
  for (const [ext, mime] of Object.entries(textExt)) {
    if (lower.endsWith(ext)) {
      return new Blob([blob], { type: `${mime}; charset=utf-8` });
    }
  }
  // Binärt format eller okänt — behåll original-blob.
  return blob;
}
