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
import { FsaIsoGitAdapter } from "@/client/lib/fsa/fs-adapter";

const ENTITY_TO_PATH: Record<string, (id: string, row: Record<string, unknown>) => string> = {
  matter: (id) => `matters/active/${id}.json`,
  contact: (id) => `contacts/${id}.json`,
  matterContact: (id) => `matter-contacts/${id}.json`,
  document: (id) => `documents/${id}.json`,
  // documentText: extraherad text från PDF/DOCX → plain text-fil. Skrivs via
  // separat mutation (eller direkt-kallad) efter att extraktionen är klar.
  documentText: (id) => `documents/text/${id}.txt`,
  documentFolder: (id) => `document-folders/${id}.json`,
  documentAnalysisSuggestion: (id) => `document-analysis-suggestions/${id}.json`,
  matterEventSuggestion: (id) => `matter-event-suggestions/${id}.json`,
  timeEntry: (id) => `time-entries/${id}.json`,
  expense: (id) => `expenses/${id}.json`,
  invoice: (id) => `invoices/${id}.json`,
  // Faktura-relaterade rader (betalningar, avbetalningsplaner, acconto-
  // avdrag) är egna entiteter. De mutateras via invoice-routerns
  // $transaction och MÅSTE persisteras separat — annars ser fakturan
  // "betald" ut i UI:t men ingen Payment-rad hamnar i git-db:n.
  payment: (id) => `payments/${id}.json`,
  paymentPlan: (id) => `payment-plans/${id}.json`,
  accontoDeduction: (id) => `acconto-deductions/${id}.json`,
  // Byrå-konfiguration ligger under .ava/ (likt users/rules).
  documentTemplate: (id) => `.ava/templates/${id}.json`,
  organization: (id) => `.ava/organizations/${id}.json`,
  office: (id) => `offices/${id}.json`,
  conflictCheck: (id) => `conflict-checks/${id}.json`,
  user: (_id, row) => `.ava/users/${(row.email as string) ?? _id}.json`,
};

export interface WriteBackOpts {
  handle: FileSystemDirectoryHandle;
  /** Räknar mutations för UI-status. */
  onCounted?: (delta: number) => void;
}

export function makeFsaWriteBack(opts: WriteBackOpts): (event: MutationEvent<Record<string, unknown>>) => Promise<void> {
  const fs = new FsaIsoGitAdapter(opts.handle);

  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async arrow function has a complexity of 10. Maximum allowed is 8.)
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
        // När ett document raderas → ta även bort binär-content + extraherad text
        // så att git-historiken blir ren och inga föräldralösa filer ligger kvar.
        if (event.entity === "document") {
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
      } else if (event.entity === "documentText") {
        // documentText sparas som plain text, INTE JSON.
        // row.text innehåller den extraherade strängen.
        const text = String(event.row.text ?? "");
        await fs.writeFile("/" + path, text);
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
