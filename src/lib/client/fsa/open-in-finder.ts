"use client";

/**
 * `openInFinder` — hjälpare som plockar fram en fils path i user:s
 * valda FSA-mapp och returnerar tillräckligt med metadata för att UI:t
 * ska kunna visa "filen ligger här"-instruktionen.
 *
 * Anledningen att det inte BARA returnerar en path: FSA exponerar inte
 * absolute filsystem-path från en handle (säkerhetsmotiv i webbplattform).
 * Vi får alltså bara den RELATIVA path inom user:s vald mapp. UI:n
 * kombinerar med mappnamnet ("AVA-firma" eller liknande) som en hint.
 *
 * Praktiskt — så här ser instruktionen ut för user:
 *   "Filen ligger under '<mappnamn>/documents/content/doc-001.pdf'.
 *    Öppna i Finder/Explorer och dubbelklicka."
 *
 * När user sparar i extern editor: `ExternalEditTracker` pollar filens
 * `lastModified` och triggar commit-callback efter en paus.
 */

import { loadHandle, ensureReadWrite, isFsaSupported } from "./handle-store";

export interface FinderTarget {
  /** Relativ path inom user:s FSA-mapp. */
  relativePath: string;
  /** Namnet på user:s vald mapp (som hen ser den i Finder). */
  folderName: string;
  /** Fil-handle redo att skickas till `tracker.watch(...)`. */
  fileHandle: FileSystemFileHandle;
  /** True om vi just laddade ner filen pga den saknades lokalt. */
  justDownloaded?: boolean;
}

export type OpenInFinderResult =
  | { kind: "ok"; target: FinderTarget }
  | { kind: "unsupported" }
  | { kind: "no-handle" }
  | { kind: "permission-denied" }
  | { kind: "file-not-found"; path: string };

export interface OpenInFinderOpts {
  /** Om filen saknas lokalt — hämta från denna base-URL och skriv till FSA innan vi öppnar. */
  downloadFallbackBase?: string;
}

/** Navigera ner genom katalog-delarna (alla utom sista = filnamnet). */
async function navigateToDir(
  root: FileSystemDirectoryHandle,
  parts: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]!);
    } catch {
      return null;
    }
  }
  return dir;
}

/** Demo-mode: lazy-ladda filen från GH Pages och skriv till FSA. */
async function downloadFallback(
  root: FileSystemDirectoryHandle,
  storagePath: string,
  fallbackBase: string,
): Promise<FileSystemFileHandle | null> {
  try {
    const { downloadToFsa } = await import("./download-to-fsa");
    const base = fallbackBase.replace(/\/+$/, "");
    const url = `${base}/${storagePath.replace(/^\/+/, "")}`;
    const result = await downloadToFsa({ root, relativePath: storagePath, url });
    return result.fileHandle;
  } catch (err) {
    console.warn("[openInFinder] download-fallback misslyckades:", err);
    return null;
  }
}

/** Hämta fil-handle; faller tillbaka på download när filen saknas lokalt. */
async function resolveFileHandle(
  dir: FileSystemDirectoryHandle,
  root: FileSystemDirectoryHandle,
  storagePath: string,
  lastPart: string,
  fallbackBase: string | undefined,
): Promise<{ fileHandle: FileSystemFileHandle; justDownloaded: boolean } | null> {
  try {
    return { fileHandle: await dir.getFileHandle(lastPart), justDownloaded: false };
  } catch {
    if (!fallbackBase) return null;
    const dl = await downloadFallback(root, storagePath, fallbackBase);
    return dl ? { fileHandle: dl, justDownloaded: true } : null;
  }
}

export async function openInFinder(storagePath: string, opts: OpenInFinderOpts = {}): Promise<OpenInFinderResult> {
  if (!isFsaSupported()) return { kind: "unsupported" };
  const root = await loadHandle("repo-root");
  if (!root) return { kind: "no-handle" };
  const granted = await ensureReadWrite(root);
  if (!granted) return { kind: "permission-denied" };

  const parts = storagePath.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "file-not-found", path: storagePath };
  const dir = await navigateToDir(root, parts);
  if (!dir) return { kind: "file-not-found", path: storagePath };

  const resolved = await resolveFileHandle(dir, root, storagePath, parts[parts.length - 1]!, opts.downloadFallbackBase);
  if (!resolved) return { kind: "file-not-found", path: storagePath };

  return {
    kind: "ok",
    target: { relativePath: storagePath, folderName: root.name, fileHandle: resolved.fileHandle, justDownloaded: resolved.justDownloaded },
  };
}
