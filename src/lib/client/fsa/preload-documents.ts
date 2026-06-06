"use client";

/**
 * `preloadAllDocuments` — för demo-mode: hämtar alla dokumentbinärer
 * (PDF/DOCX) från GH Pages och skriver dem till user:s FSA-mapp så hen
 * kan editera dem i extern app. Idempotent — hoppar över filer som
 * redan finns.
 *
 * Flöde:
 *   1. Hämta manifest.json → få listan av documents/<id>.json-metadata
 *   2. För varje metadata-JSON: hämta, parsa, läs `storagePath`
 *   3. Ladda ner binärfilen från `<base>/<storagePath>` → skriv till FSA
 *
 * Returnerar progress via `onProgress`-callback så UI:n kan visa
 * "Förladdar 7 av 40…".
 */

import { downloadToFsa } from "./download-to-fsa";

export interface PreloadOpts {
  root: FileSystemDirectoryHandle;
  /** Bas-URL där seed-data finns. T.ex. "https://ulrik-s.github.io/ava". */
  baseUrl: string;
  onProgress?: (done: number, total: number, path: string) => void;
  fetchFn?: typeof fetch;
  concurrency?: number;
}

export interface PreloadResult {
  downloaded: number;
  skipped: number;
  failed: number;
}

interface DocMeta { storagePath?: string }

// eslint-disable-next-line complexity
export async function preloadAllDocuments(opts: PreloadOpts): Promise<PreloadResult> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const base = opts.baseUrl.replace(/\/+$/, "");

  // 1. Manifest → metadata-JSONs
  const manifestRes = await fetchFn(`${base}/manifest.json`);
  if (!manifestRes.ok) throw new Error(`preload: HTTP ${manifestRes.status} på manifest`);
  const manifest = await manifestRes.json() as { paths?: string[] };
  const docMetaPaths = (manifest.paths ?? []).filter(
    (p) => p.startsWith("documents/") && p.endsWith(".json"),
  );

  // 2. Läs varje metadata och extrahera storagePath
  const binaryPaths: string[] = [];
  for (const metaPath of docMetaPaths) {
    try {
      const r = await fetchFn(`${base}/${metaPath}`);
      if (!r.ok) continue;
      const meta = await r.json() as DocMeta;
      if (meta.storagePath) binaryPaths.push(meta.storagePath);
    } catch {
      // tyst — räknas som failed vid download-loop
    }
  }

  // 3. Ladda ner med concurrency
  const queue = [...binaryPaths];
  const total = binaryPaths.length;
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  const concurrency = opts.concurrency ?? 6;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) workers.push(worker());
  await Promise.all(workers);
  return { downloaded, skipped, failed };

  async function worker(): Promise<void> {
    for (;;) {
      const path = queue.shift();
      if (!path) return;
      try {
        if (await fileExists(opts.root, path)) {
          skipped += 1;
        } else {
          const url = `${base}/${path.replace(/^\/+/, "")}`;
          await downloadToFsa({ root: opts.root, relativePath: path, url, fetchFn });
          downloaded += 1;
        }
      } catch (err) {
        console.warn("[preload] misslyckades", path, err);
        failed += 1;
      }
      done += 1;
      opts.onProgress?.(done, total, path);
    }
  }
}

async function fileExists(root: FileSystemDirectoryHandle, relativePath: string): Promise<boolean> {
  const parts = relativePath.replace(/^\/+/, "").split("/").filter(Boolean);
  const fileName = parts[parts.length - 1];
  if (fileName === undefined) return false; // tom sökväg → finns inte
  let dir: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]!); }
    catch { return false; }
  }
  try { await dir.getFileHandle(fileName); return true; }
  catch { return false; }
}
