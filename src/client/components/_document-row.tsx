"use client";

import { Fragment } from "react";
import { formatFileSize } from "./_drag-helpers";
import { readFromFsa } from "@/client/lib/fsa/read-from-fsa";

export interface DocumentRecord {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  version: number;
  matterId: string;
  folderId: string | null;
  uploadedById: string;
  createdAt: string | Date;
  uploadedBy: { name: string | null };
  title: string | null;
  documentType: string | null;
  summary: string | null;
  analyzedAt: string | Date | null;
  analysisError: string | null;
}

interface Props {
  doc: DocumentRecord;
  depth: number;
  isDragging: boolean;
  isAnalyzing: boolean;
  /** Sätts till true under upload-fasen (FSA-write + register +
   *  tree-invalidate). Klick/öppna är disabled tills false. */
  isUploading?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  reanalyzePending: boolean;
}

const ANALYSIS_GRACE_MS = 5 * 60 * 1000;

export function DocumentRow({
  doc,
  depth,
  isDragging,
  isAnalyzing,
  isUploading,
  onDragStart,
  onDragEnd,
  onReanalyze,
  onDelete,
  reanalyzePending,
}: Props) {
  return (
    <Fragment>
      <tr
        draggable={!isUploading}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`hover:bg-gray-50 ${isDragging ? "opacity-50" : ""} ${isUploading ? "opacity-60 pointer-events-none" : ""}`}
        title={isUploading ? "Laddar upp…" : undefined}
      >
        <td className="px-6 py-2.5 text-sm">
          <div
            style={{ paddingLeft: `${depth * 20 + 20}px` }}
            className="flex items-center gap-2"
          >
            <DocumentNameButton doc={doc} isAnalyzing={isAnalyzing} disabled={isUploading} />
            {isUploading && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                title="Sparas lokalt — pushas till git när auto-sync kör"
              >
                <span className="animate-pulse">●</span> Lokal
              </span>
            )}
          </div>
        </td>
        <td className="px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">{formatFileSize(doc.fileSize)}</td>
        <td className="px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">
          {new Date(doc.createdAt).toLocaleDateString("sv-SE")}
        </td>
        <td className="px-6 py-2.5 text-right whitespace-nowrap">
          <DocumentLinks doc={doc} disabled={isUploading} />
          <button
            onClick={onReanalyze}
            disabled={reanalyzePending || isUploading}
            className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 disabled:opacity-50"
            title={isUploading ? "Vänta tills uppladdningen är klar" : "Kör AI-analys på nytt"}
          >
            🧠 Analysera
          </button>
          <button
            onClick={onDelete}
            disabled={isUploading}
            className="text-xs text-red-500 hover:underline disabled:opacity-50"
          >
            Ta bort
          </button>
        </td>
      </tr>
    </Fragment>
  );
}

function isWithinAnalysisGrace(doc: DocumentRecord): boolean {
  if (doc.analyzedAt || doc.analysisError) return false;
   
  return Date.now() - new Date(doc.createdAt).getTime() < ANALYSIS_GRACE_MS;
}

/**
 * `DocumentLinks` — "Öppna" + "Visa" + "Ladda ner".
 *
 * I Tauri-build:n exponeras "Öppna i [app]"-knappen som anropar
 * Rust-command `open_in_default_app` så användaren får sin OS-default
 * PDF-editor (PDFGear/Preview). Efter redigering committar
 * `Spara ändringar`-flödet på matter-sidan.
 *
 * I demo-build:n pekar "Visa"/"Ladda ner" mot GH Pages.
 * I full server-build:n mot /api/documents/<id>/download.
 */
// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'DocumentLinks' has a complexity of 12. Maximum allowed is 8.)
function DocumentLinks({ doc, disabled }: { doc: DocumentRecord; disabled?: boolean }) {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";
  let viewHref: string;
  let downloadHref: string;
  if (isDemo) {
    const repo = process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ?? "ulrik-s/ava-demo";
    const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
    const base = m ? `https://${m[1]}.github.io/${m[2]}` : repo.replace(/\/+$/, "");
    const rec = doc as DocumentRecord & { storagePath?: string };
    const path = rec.storagePath ?? `documents/${doc.id}`;
    viewHref = `${base}/${path}`;
    downloadHref = viewHref;
  } else {
    viewHref = `/api/documents/${doc.id}/download`;
    downloadHref = `/api/documents/${doc.id}/download?download=1`;
  }

   
  const openInEditor = async () => {
    // Web/demo: läs lokal kopia från FSA om den finns (nyligen uppladdade
    // filer hinner inte till remote än), annars GH Pages-URL.
    // Browser kan EJ navigera till file:// från https://, så vi öppnar
    // som blob:-URL i ny tab → Chrome visar PDF inline.
    // För PDFGear/Preview/Acrobat → mounta WebDAV-disken i Inställningar.
    const rec = doc as DocumentRecord & { storagePath?: string };
    const path = rec.storagePath ?? "";

    if (path) {
      try {
        const { isFsaSupported, loadHandle } = await import("@/client/lib/fsa/handle-store");
        if (isFsaSupported()) {
          const handle = await loadHandle("repo-root");
          if (handle) {
            const blob = await readFromFsa(handle, path);
            if (blob) {
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank", "noopener,noreferrer");
              // Återvinn URL:n efter en stund (browsern behåller den medan tab:n öppen)
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
              return;
            }
          }
        }
      } catch (err) {
        console.warn("[open] FSA-läsning misslyckades, faller tillbaka till GH Pages:", err);
      }
    }

    // Fallback: GH Pages (för pushade dokument i demo) eller server-URL
    const proceed = confirm(
      "Dokumentet öppnas i Chrome.\n\n" +
      "Vill du öppna i PDFGear / Preview / Acrobat istället?\n" +
      "→ Mounta AVA:s WebDAV-disk via Inställningar och öppna filen från Finder/Utforskaren.\n\n" +
      "Klicka OK för att öppna i Chrome ändå."
    );
    if (proceed) window.open(viewHref, "_blank", "noopener,noreferrer");
  };

  const openExternal = async () => {
    const { openInFinder } = await import("@/client/lib/fsa/open-in-finder");
    const { getExternalEditTracker } = await import("@/client/lib/fsa/external-edit-tracker");
    const r = await openInFinder(doc.storagePath);
    if (r.kind === "unsupported") { alert("Din webbläsare stödjer inte File System Access. Använd Chrome eller Edge."); return; }
    if (r.kind === "no-handle") { alert("Du har inte valt en lokal mapp än. Gå till Inställningar → välj firma-mapp."); return; }
    if (r.kind === "permission-denied") { alert("AVA fick inte tillåtelse att läsa filen. Klicka 'Tillåt' nästa gång prompten dyker upp."); return; }
    if (r.kind === "file-not-found") { alert(`Hittade inte filen i din lokala mapp: ${r.path}`); return; }
    const t = getExternalEditTracker();
    if (!t) { alert("Edit-tracker:n är inte initialiserad — ladda om sidan."); return; }
    await t.watch({ docId: doc.id, path: r.target.relativePath, handle: r.target.fileHandle });
    alert(
      `Öppna filen i Finder/Explorer:\n\n` +
      `${r.target.folderName}/${r.target.relativePath}\n\n` +
      `Dubbelklicka för att öppna i PDF Gear, Preview, Word etc. AVA committar automatiskt när du sparar (efter 90 sekunder utan ändringar) — eller klicka "Spara nu" i den gula bannern högst upp.`,
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={openInEditor}
        disabled={disabled}
        className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 disabled:opacity-50 disabled:cursor-not-allowed"
        title={disabled ? "Vänta tills uppladdningen är klar" : "Öppna i din browser"}
      >
        🖊 Öppna
      </button>
      <button
        type="button"
        onClick={openExternal}
        disabled={disabled}
        className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 disabled:opacity-50 disabled:cursor-not-allowed"
        title={disabled ? "Vänta tills uppladdningen är klar" : "Öppna i extern app (PDF Gear, Preview...) — AVA committar dina ändringar automatiskt"}
      >
        🖥 Editera externt
      </button>
      <a
        href={disabled ? undefined : viewHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
        title={disabled ? "Vänta tills uppladdningen är klar" : "Visa i webbläsaren"}
        aria-disabled={disabled}
      >
        👁 Visa
      </a>
      <a
        href={disabled ? undefined : downloadHref}
        className={`text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
        title={disabled ? "Vänta tills uppladdningen är klar" : "Ladda ner"}
        aria-disabled={disabled}
      >
        ⬇ Ladda ner
      </a>
    </>
  );
}

// readFromFsa flyttad till `@/client/lib/fsa/read-from-fsa` (delas med
// search-sidan + andra "öppna lokal kopia"-flöden).

// eslint-disable-next-line complexity
function DocumentNameButton({ doc, isAnalyzing, disabled }: { doc: DocumentRecord; isAnalyzing: boolean; disabled?: boolean }) {
  const isWaitingAnalysis = isAnalyzing || isWithinAnalysisGrace(doc);

  const isDemo = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";
  const onClick = async () => {
    if (disabled) return;
    const { openDocument } = await import("@/client/lib/firma/open-document");
    const { loadHandle } = await import("@/client/lib/fsa/handle-store");
    const rec = doc as DocumentRecord & { storagePath?: string };
    await openDocument({
      doc: { id: doc.id, storagePath: rec.storagePath, fileName: doc.fileName },
      isDemo,
      demoRepo: process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO,
      loadHandle: () => loadHandle("repo-root"),
      readFromHandle: readFromFsa,
      openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
      notifyError: (m) => alert(m),
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-2 text-blue-600 hover:underline text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
      title={disabled ? "Laddar upp — vänta tills filen är registrerad" : (doc.summary || "Öppna i extern app (PDFGear för PDF)")}
    >
      <span className="text-lg leading-tight">📄</span>
      <span className="flex flex-col min-w-0">
        <span className="font-medium">{doc.title || doc.fileName}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500 font-normal">
          {doc.documentType && (
            <span className="inline-block rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
              {doc.documentType}
            </span>
          )}
          {doc.title && <span className="truncate">{doc.fileName}</span>}
          {isWaitingAnalysis && <span className="text-amber-600 text-[10px]">⏳ analyseras…</span>}
          {doc.analysisError && !isAnalyzing && (
            <span className="text-red-500 text-[10px]" title={doc.analysisError}>
              ⚠ analys-fel
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
