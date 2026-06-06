"use client";

/**
 * `downloadToFsa` — hämtar en fil från en (publik) URL och skriver
 * bytes:erna till en FSA-mapp på rätt relativ-path. Skapar saknade
 * underkataloger.
 *
 * Används av:
 *   - "🖥 Editera externt"-flödet i demo-mode: filen finns på GH Pages
 *     men inte i user:s lokala mapp → vi laddar ner den just-in-time
 *     innan vi öppnar den i extern editor.
 *   - "Förladda alla dokument"-knappen i /settings.
 */

export interface DownloadInput {
  /** Root-FSA-handle. */
  root: FileSystemDirectoryHandle;
  /** Relativ path inom mappen, t.ex. "documents/content/doc-001.pdf". */
  relativePath: string;
  /** Absolut URL att hämta från, t.ex. "https://ulrik-s.github.io/ava/documents/content/doc-001.pdf". */
  url: string;
  /** Injectable fetch (för tester). */
  fetchFn?: typeof fetch;
}

export interface DownloadResult {
  fileHandle: FileSystemFileHandle;
  sizeBytes: number;
}

export async function downloadToFsa(input: DownloadInput): Promise<DownloadResult> {
  const fetchFn = input.fetchFn ?? globalThis.fetch.bind(globalThis);
  const parts = input.relativePath.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("downloadToFsa: tom relativePath");

  // Navigera/skapa kataloger
  let dir: FileSystemDirectoryHandle = input.root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
  }

  const res = await fetchFn(input.url);
  if (!res.ok) throw new Error(`downloadToFsa: HTTP ${res.status} från ${input.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();

  return { fileHandle, sizeBytes: bytes.byteLength };
}
