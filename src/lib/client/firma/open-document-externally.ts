"use client";

/**
 * `runExternalEdit` — startar "Editera externt"-flödet för ett dokument.
 *
 * Steg:
 *   1. Plocka filens FSA-handle i user:s lokala mapp.
 *   2. Registrera handle:n i `ExternalEditTracker` så save-detektering
 *      pollar `lastModified` i bakgrunden.
 *   3. Returnera modal-state med blob-URL + path → UI:n visar
 *      "Öppna fil"-knapp (download via `<a download>` → OS öppnar med
 *      default-app → PDF Gear / Preview / Word / etc.).
 *
 * När user sparar i extern editor: tracker triggar commit-callback
 * (registrerad i `external-edit-registrar`) → iso-git commit + push.
 *
 * Separat fil eftersom samma flöde behövs både i tree-vyn (DocumentRow)
 * och i list-vyn (DocumentsListView).
 */

import type { ModalState } from "@/components/documents/external-edit-modal";

interface Doc {
  id: string;
  fileName: string;
  storagePath: string;
}

const DEFAULT_DEMO_REPO_FALLBACK = "ulrik-s/ava-demo";

export async function runExternalEdit(doc: Doc): Promise<ModalState> {
  const { openInFinder } = await import("@/lib/client/fsa/open-in-finder");
  const { getExternalEditTracker } = await import("@/lib/client/fsa/external-edit-tracker");

  const fallbackBase = process.env.NEXT_PUBLIC_DEMO_BUILD === "1"
    ? (() => {
        const repo = process.env.NEXT_PUBLIC_DEMO_REPO || process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO || DEFAULT_DEMO_REPO_FALLBACK;
        const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
        return m ? `https://${m[1]}.github.io/${m[2]}` : repo;
      })()
    : undefined;

  const r = await openInFinder(doc.storagePath, { downloadFallbackBase: fallbackBase });
  if (r.kind === "unsupported") {
    return { kind: "error", title: "Browser stödjer inte File System Access",
      message: "Din webbläsare stödjer inte File System Access API. Använd Chrome eller Edge på desktop." };
  }
  if (r.kind === "no-handle") {
    return { kind: "error", title: "Ingen lokal mapp vald",
      message: "Du har inte valt en lokal mapp än. Gå till Inställningar → 'Datakälla' → välj firma-mapp." };
  }
  if (r.kind === "permission-denied") {
    return { kind: "error", title: "Saknar behörighet",
      message: "AVA fick inte tillåtelse att läsa filen. Klicka 'Tillåt' nästa gång prompten dyker upp." };
  }
  if (r.kind === "file-not-found") {
    return { kind: "error", title: "Filen hittades inte",
      message: `Hittade inte filen i din lokala mapp: ${r.path}` };
  }

  const t = getExternalEditTracker();
  if (!t) {
    return { kind: "error", title: "Edit-tracker inte initialiserad",
      message: "Ladda om sidan så registreras tracker:n." };
  }
  await t.watch({ docId: doc.id, path: r.target.relativePath, handle: r.target.fileHandle });

  return {
    kind: "ok",
    fileName: doc.fileName,
    folderName: r.target.folderName,
    relativePath: r.target.relativePath,
    fileHandle: r.target.fileHandle,
  };
}

/**
 * Heuristik: vilka file-typer ska defaulta till "öppna externt" istället
 * för "visa i browser-tab"?
 *
 * PDF + Office-format → ja (de har bra native-editors).
 * Bilder/text/HTML → nej (browser visar dem bra).
 */
export function shouldPreferExternalEdit(fileName: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?)$/i.test(fileName);
}
