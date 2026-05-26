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
}

export async function openDocument(deps: OpenDocumentDeps): Promise<"opened-gh-pages" | "opened-blob" | "error"> {
  const { doc, isDemo, demoRepo, loadHandle, readFromHandle, openUrl, notifyError } = deps;
  const storagePath = doc.storagePath ?? `documents/${doc.id}`;

  if (isDemo) {
    const repo = demoRepo ?? "ulrik-s/ava-demo";
    const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
    const base = m ? `https://${m[1]}.github.io/${m[2]}` : repo.replace(/\/+$/, "");
    openUrl(`${base}/${storagePath}`);
    return "opened-gh-pages";
  }

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

  // För text-baserade format MÅSTE vi tagga blob:en med "charset=utf-8",
  // annars renderar browsern ofta som ISO-8859-1 → å/ä/ö blir trasiga.
  // Binärformat (PDF, DOCX, bilder) behåller sin mime-type oförändrad.
  const url = URL.createObjectURL(withUtf8CharsetIfText(blob, storagePath));
  openUrl(url);
  // Vänta lite innan revoke så browsern hinner ladda — 60 s är gott nog.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
