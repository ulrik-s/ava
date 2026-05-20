/**
 * `fsaWriteBack` — mappar DataStore-mutations till JSON-filer i
 * en FSA-mounted folder.
 *
 * Varje entitets-typ har en projection-path (matters/active/{id}.json
 * etc.) och skrivs ut som JSON. Delete → unlink. Create/update →
 * skriv (overskriver om finns).
 *
 * Path-konvention följer `default-registry.ts` så samma filer som
 * GhPagesDemoLoader läser från GH Pages är de vi skriver till disk.
 */

import type { MutationEvent } from "@/server/data-store/in-memory/writable-delegate";
import { FsaIsoGitAdapter } from "@/lib/fsa/fs-adapter";

const ENTITY_TO_PATH: Record<string, (id: string, row: Record<string, unknown>) => string> = {
  matter: (id) => `matters/active/${id}.json`,
  contact: (id) => `contacts/${id}.json`,
  matterContact: (id) => `matter-contacts/${id}.json`,
  document: (id) => `documents/${id}.json`,
  timeEntry: (id) => `time-entries/${id}.json`,
  expense: (id) => `expenses/${id}.json`,
  invoice: (id) => `invoices/${id}.json`,
  user: (_id, row) => `.ava/users/${(row.email as string) ?? _id}.json`,
};

export interface WriteBackOpts {
  handle: FileSystemDirectoryHandle;
  /** Räknar mutations för UI-status. */
  onCounted?: (delta: number) => void;
}

export function makeFsaWriteBack(opts: WriteBackOpts): (event: MutationEvent<Record<string, unknown>>) => Promise<void> {
  const fs = new FsaIsoGitAdapter(opts.handle);

  return async (event) => {
    const pathFn = ENTITY_TO_PATH[event.entity];
    if (!pathFn) {
      console.warn(`[fsa-writeback] okänd entitet '${event.entity}' — hoppar över`);
      return;
    }
    const id = String(event.row.id);
    const path = pathFn(id, event.row);

    try {
      if (event.kind === "delete") {
        await fs.unlink("/" + path);
      } else {
        const json = JSON.stringify(event.row, null, 2) + "\n";
        await fs.writeFile("/" + path, json);
      }
      opts.onCounted?.(+1);
    } catch (err) {
      console.error(`[fsa-writeback] kunde inte skriva ${path}:`, err);
      throw err;
    }
  };
}
