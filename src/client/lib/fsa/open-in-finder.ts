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
}

export type OpenInFinderResult =
  | { kind: "ok"; target: FinderTarget }
  | { kind: "unsupported" }
  | { kind: "no-handle" }
  | { kind: "permission-denied" }
  | { kind: "file-not-found"; path: string };

export async function openInFinder(storagePath: string): Promise<OpenInFinderResult> {
  if (!isFsaSupported()) return { kind: "unsupported" };
  const root = await loadHandle("repo-root");
  if (!root) return { kind: "no-handle" };
  const granted = await ensureReadWrite(root);
  if (!granted) return { kind: "permission-denied" };

  // Navigera ner till filen
  const parts = storagePath.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "file-not-found", path: storagePath };
  let dir: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]);
    } catch {
      return { kind: "file-not-found", path: storagePath };
    }
  }
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  } catch {
    return { kind: "file-not-found", path: storagePath };
  }

  return {
    kind: "ok",
    target: {
      relativePath: storagePath,
      folderName: root.name,
      fileHandle,
    },
  };
}
