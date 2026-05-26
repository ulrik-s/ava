"use client";

/**
 * `readFromFsa` — läs en fil ur ett FSA/OPFS-handle och returnera som Blob.
 *
 * Returnerar `null` om path:n inte finns istället för att kasta — uppringare
 * (öppna-dokument-flöden) behandlar `null` som "filen finns inte här lokalt
 * än, fallback till annan källa".
 */
export async function readFromFsa(handle: FileSystemDirectoryHandle, path: string): Promise<Blob | null> {
  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]); }
    catch { return null; }
  }
  try {
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch { return null; }
}
