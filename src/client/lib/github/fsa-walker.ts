"use client";

/**
 * Walk FSA-mappen rekursivt och returnera alla filer + deras git-blob-SHA.
 *
 * Hoppar över `.git/` och `.ava/` (våra egna metadatakataloger). Allt
 * annat behandlas som spårat innehåll.
 */

import { gitBlobSha1 } from "./git-blob-hash";

export interface WalkedFile {
  path: string;
  /** git-blob-SHA för fil-innehållet (för diff mot remote tree). */
  sha: string;
  bytes: Uint8Array;
}

const IGNORED_DIRS = new Set([".git", ".ava", "node_modules", ".next", "dist"]);

export async function walkFsa(handle: FileSystemDirectoryHandle): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  await walk(handle, "", out);
  return out;
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: WalkedFile[]): Promise<void> {
  // FileSystemDirectoryHandle:s default async-iteration ger
  // [name, handle]-tupler (samma som .entries()). Vi använder
  // .values() för att få handles direkt.
   
  const handleWithValues = dir as FileSystemDirectoryHandle & { values: () => AsyncIterable<FileSystemHandle> };
  for await (const entry of handleWithValues.values()) {
    if (entry.kind === "directory") {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`, out);
    } else {
      const fh = entry as FileSystemFileHandle;
      const file = await fh.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha = await gitBlobSha1(bytes);
      out.push({ path: `${prefix}${entry.name}`, sha, bytes });
    }
  }
}

/**
 * Skriv en byte-stream till en sökväg i FSA-mappen, skapande
 * mellanliggande kataloger om de saknas.
 */
export async function writeFile(handle: FileSystemDirectoryHandle, path: string, bytes: Uint8Array): Promise<void> {
  const segments = path.split("/").filter((s) => s.length > 0);
  let dir = handle;
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i], { create: true });
  }
  const fileName = segments[segments.length - 1];
  const fh = await dir.getFileHandle(fileName, { create: true });
  const writable = await (fh as FileSystemFileHandle & {
    createWritable: () => Promise<FileSystemWritableFileStream>;
  }).createWritable();
  await writable.write(bytes.buffer as ArrayBuffer);
  await writable.close();
}

/**
 * Radera en fil i FSA-mappen. Ignorerar om filen inte finns.
 */
export async function deleteFile(handle: FileSystemDirectoryHandle, path: string): Promise<void> {
  const segments = path.split("/").filter((s) => s.length > 0);
  let dir = handle;
  for (let i = 0; i < segments.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(segments[i]);
    } catch {
      return; // mellanliggande katalog saknas → filen finns inte
    }
  }
  try {
    await dir.removeEntry(segments[segments.length - 1]);
  } catch { /* fil saknas redan */ }
}
