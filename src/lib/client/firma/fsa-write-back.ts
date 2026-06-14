/**
 * `fsaWriteBack` — mappar DataStore-mutations till JSON-filer i
 * en FSA-mounted folder.
 *
 * Varje entitets-typ har en projection-path (matters/active/{id}.json
 * etc.) och skrivs ut som JSON. Delete → unlink. Create/update →
 * skriv (overskriver om finns).
 *
 * Path-konvention härleds från `ENTITY_REGISTRY` i `src/shared/schemas/` —
 * single source of truth för "vart skrivs varje entitet".
 *
 * `documentText` är ett specialfall: extraherad text från PDF/DOCX skrivs
 * som plain text till `documents/text/<id>.txt` (inte JSON). Den är inte
 * en git-db-entitet — bara en sökindex-cache — så ligger inte i registry:t.
 */

import { FsaIsoGitAdapter } from "@/lib/client/fsa/fs-adapter";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";

/**
 * Minimal fs-yta som write-back behöver. Uppfylls av `FsaIsoGitAdapter`
 * (self-hosted/OPFS-working-copy) OCH av MemFs-slaben (persisterad in-memory
 * git-db för demo). Samma mappnings-logik, olika backing-store.
 */
export interface WriteBackFs {
  writeFile(path: string, data: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

function pathForEntity(entity: string, id: string, row: Record<string, unknown>): string | null {
  if (entity === "documentText") return `documents/text/${id}.txt`;
  const entry = (ENTITY_REGISTRY as Record<string, { gitPath: (id: string, row: Record<string, unknown>) => string }>)[entity];
  return entry ? entry.gitPath(id, row) : null;
}

export interface WriteBackOpts {
  handle: FileSystemDirectoryHandle;
  /** Räknar mutations för UI-status. */
  onCounted?: (delta: number) => void;
}

/**
 * Kärnan: mappar en DataStore-mutation → fil-skrivning mot valfri
 * `WriteBackFs`. fs-agnostisk så FSA-working-copyn och MemFs-slaben delar
 * exakt samma path-/JSON-logik (DRY).
 */
export function makeWriteBack(
  fs: WriteBackFs,
  onCounted?: (delta: number) => void,
): (event: MutationEvent<Record<string, unknown>>) => Promise<void> {
  return async (event) => {
    const id = String(event.row.id);
    const path = pathForEntity(event.entity, id, event.row);
    if (!path) {
      console.warn(`[writeback] okänd entitet '${event.entity}' — hoppar över`);
      return;
    }
    try {
      if (event.kind === "delete") await handleDelete(fs, event, path, id);
      else if (event.entity === "documentText") await fs.writeFile("/" + path, String(event.row.text ?? ""));
      else await fs.writeFile("/" + path, JSON.stringify(event.row, null, 2) + "\n");
      onCounted?.(+1);
    } catch (err) {
      console.error(`[writeback] kunde inte skriva ${path}:`, err);
      throw err;
    }
  };
}

export function makeFsaWriteBack(opts: WriteBackOpts): (event: MutationEvent<Record<string, unknown>>) => Promise<void> {
  return makeWriteBack(new FsaIsoGitAdapter(opts.handle), opts.onCounted);
}

async function handleDelete(
  fs: WriteBackFs,
  event: MutationEvent<Record<string, unknown>>,
  path: string,
  id: string,
): Promise<void> {
  await fs.unlink("/" + path);
  // När ett document raderas → ta även bort binär-content + extraherad text
  // så git-historiken blir ren och inga föräldralösa filer ligger kvar.
  if (event.entity !== "document") return;
  const storagePath = String(event.row.storagePath ?? "");
  if (storagePath) {
    await fs.unlink("/" + storagePath.replace(/^\/+/, "")).catch(() => {
      /* redan borta */
    });
  }
  await fs.unlink(`/documents/text/${id}.txt`).catch(() => {
    /* ev. aldrig extraherad */
  });
}
