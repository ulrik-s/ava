/**
 * `uploadDocumentToFsa` — laddar upp en fil via File System Access API.
 *
 * Steg:
 *   1. Generera unikt id för dokumentet
 *   2. Läs fil-bytes
 *   3. Skriv till `documents/content/<id>.<ext>` i FSA-folder
 *   4. Returnera metadata som `document.create`-mutation kan använda
 *      för att skapa JSON-projektionen (vilken då också skrivs via
 *      WritableDelegate → fsa-write-back).
 *
 * Designval (Single responsibility): bara filhantering, inga
 * tRPC-anrop. Caller wirar in:nytt-document genom mutation efteråt.
 */

import { FsaIsoGitAdapter } from "./fs-adapter";

export interface UploadResult {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export interface UploadOptions {
  handle: FileSystemDirectoryHandle;
  matterId: string;
  file: File;
  /** Optional id-generator (för deterministiska tester). */
  generateId?: () => string;
}

function defaultGenerateId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extFromFile(file: File): string {
  const m = file.name.match(/\.([a-zA-Z0-9]+)$/);
  return m?.[1] ? m[1].toLowerCase() : "bin";
}

export async function uploadDocumentToFsa(opts: UploadOptions): Promise<UploadResult> {
  const id = (opts.generateId ?? defaultGenerateId)();
  const ext = extFromFile(opts.file);
  const storagePath = `documents/content/${id}.${ext}`;

  const fs = new FsaIsoGitAdapter(opts.handle);
  const buf = new Uint8Array(await opts.file.arrayBuffer());
  await fs.writeFile("/" + storagePath, buf);

  return {
    id,
    fileName: opts.file.name,
    mimeType: opts.file.type || "application/octet-stream",
    sizeBytes: opts.file.size,
    storagePath,
  };
}
