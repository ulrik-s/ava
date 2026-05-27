"use client";

import { Fragment, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatFileSize } from "./_drag-helpers";
import { readFromFsa } from "@/lib/client/fsa/read-from-fsa";
import { ExternalEditModal, type ModalState } from "./external-edit-modal";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";

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
        <td className="px-3 sm:px-6 py-2.5 text-sm">
          <div
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
            className="flex items-center gap-2 min-w-0"
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
        <td className="hidden sm:table-cell px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">{formatFileSize(doc.fileSize)}</td>
        <td className="hidden sm:table-cell px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">
          {new Date(doc.createdAt).toLocaleDateString("sv-SE")}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          <DocumentActions
            doc={doc}
            disabled={isUploading}
            onReanalyze={onReanalyze}
            onDelete={onDelete}
            reanalyzePending={reanalyzePending}
          />
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
 * `DocumentActions` — alla rad-actions samlade i EN kebab-meny (⋮).
 *
 * Tidigare låg Öppna / Editera externt / Visa / Ladda ner / Analysera /
 * Ta bort som inline-knappar → raden blev för bred → horisontell scroll
 * på små skärmar. Nu en touch-vänlig overflow-meny som funkar på alla
 * skärmstorlekar (se [[ActionMenu]]).
 *
 * Länk-vägar:
 *   - demo-build → GH Pages-URL (Visa/Ladda ner).
 *   - server-build → /api/documents/<id>/download.
 */
// eslint-disable-next-line complexity -- bygger länk-URL:er + actions (demo vs server)
function DocumentActions({
  doc,
  disabled,
  onReanalyze,
  onDelete,
  reanalyzePending,
}: {
  doc: DocumentRecord;
  disabled?: boolean;
  onReanalyze: () => void;
  onDelete: () => void;
  reanalyzePending: boolean;
}) {
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
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
    // För PDFGear/Preview/Acrobat → använd "Editera externt" (FSA).
    const rec = doc as DocumentRecord & { storagePath?: string };
    const path = rec.storagePath ?? "";

    if (path) {
      try {
        const { isFsaSupported, loadHandle } = await import("@/lib/client/fsa/handle-store");
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

    // Fallback: GH Pages (för pushade dokument i demo) eller server-URL.
    // Vill användaren redigera i en extern app (PDF Gear/Preview/Acrobat)
    // är vägen "Editera externt" (öppnar filen från din lokala mapp via
    // File System Access) — inte detta visnings-flöde.
    window.open(viewHref, "_blank", "noopener,noreferrer");
  };

  const openExternal = async () => {
    const { openInFinder } = await import("@/lib/client/fsa/open-in-finder");
    const { getExternalEditTracker } = await import("@/lib/client/fsa/external-edit-tracker");
    // I demo-mode finns inte filerna i user:s FSA-mapp by default — vi
    // lazy-downloadar dem från GH Pages om de saknas.
    const fallbackBase = (process.env.NEXT_PUBLIC_DEMO_BUILD === "1")
      ? (() => {
          const repo = process.env.NEXT_PUBLIC_DEMO_REPO || process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO || "ulrik-s/ava-demo";
          const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
          return m ? `https://${m[1]}.github.io/${m[2]}` : repo;
        })()
      : undefined;
    const r = await openInFinder(doc.storagePath, { downloadFallbackBase: fallbackBase });
    if (r.kind === "unsupported") {
      setModal({ kind: "error", title: "Browser stödjer inte File System Access",
        message: "Din webbläsare stödjer inte File System Access API. Använd Chrome eller Edge på desktop." });
      return;
    }
    if (r.kind === "no-handle") {
      setModal({ kind: "error", title: "Ingen lokal mapp vald",
        message: "Du har inte valt en lokal mapp än. Gå till Inställningar → 'Datakälla' → välj firma-mapp." });
      return;
    }
    if (r.kind === "permission-denied") {
      setModal({ kind: "error", title: "Saknar behörighet",
        message: "AVA fick inte tillåtelse att läsa filen. Klicka 'Tillåt' nästa gång prompten dyker upp." });
      return;
    }
    if (r.kind === "file-not-found") {
      setModal({ kind: "error", title: "Filen hittades inte",
        message: `Hittade inte filen i din lokala mapp: ${r.path}` });
      return;
    }
    const t = getExternalEditTracker();
    if (!t) {
      setModal({ kind: "error", title: "Edit-tracker inte initialiserad",
        message: "Ladda om sidan så registreras tracker:n." });
      return;
    }
    await t.watch({ docId: doc.id, path: r.target.relativePath, handle: r.target.fileHandle });
    setModal({
      kind: "ok",
      fileName: doc.fileName,
      folderName: r.target.folderName,
      relativePath: r.target.relativePath,
      fileHandle: r.target.fileHandle,
    });
  };

  const uploadingTitle = disabled ? "Vänta tills uppladdningen är klar" : undefined;
  const items: ActionMenuItem[] = [
    { key: "open", label: "Öppna i webbläsaren", icon: <span aria-hidden>🖊</span>, onSelect: openInEditor, disabled, title: uploadingTitle ?? "Öppna i din browser" },
    { key: "external", label: "Editera externt (PDF Gear, Preview…)", icon: <span aria-hidden>🖥</span>, onSelect: openExternal, disabled, title: uploadingTitle ?? "AVA committar dina ändringar automatiskt" },
    { key: "view", label: "Visa", icon: <span aria-hidden>👁</span>, href: viewHref, newTab: true, disabled, title: uploadingTitle ?? "Visa i webbläsaren" },
    { key: "download", label: "Ladda ner", icon: <span aria-hidden>⬇</span>, href: downloadHref, download: true, disabled, title: uploadingTitle ?? "Ladda ner" },
    { key: "reanalyze", label: "Analysera (AI)", icon: <span aria-hidden>🧠</span>, onSelect: onReanalyze, disabled: disabled || reanalyzePending, title: uploadingTitle ?? "Kör AI-analys på nytt" },
    { key: "delete", label: "Ta bort", icon: <Trash2 size={15} />, onSelect: onDelete, danger: true, disabled, title: uploadingTitle },
  ];

  return (
    <>
      <ExternalEditModal state={modal} onClose={() => setModal({ kind: "closed" })} />
      <ActionMenu items={items} disabled={disabled} label="Dokumentåtgärder" />
    </>
  );
}

// readFromFsa flyttad till `@/lib/client/fsa/read-from-fsa` (delas med
// search-sidan + andra "öppna lokal kopia"-flöden).

// eslint-disable-next-line complexity
function DocumentNameButton({ doc, isAnalyzing, disabled }: { doc: DocumentRecord; isAnalyzing: boolean; disabled?: boolean }) {
  const isWaitingAnalysis = isAnalyzing || isWithinAnalysisGrace(doc);

  const isDemo = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";
  const onClick = async () => {
    if (disabled) return;
    const { openDocument } = await import("@/lib/client/firma/open-document");
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
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
      <span className="text-lg leading-tight flex-shrink-0">📄</span>
      <span className="flex flex-col min-w-0">
        <span className="font-medium break-words">{doc.title || doc.fileName}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500 font-normal min-w-0">
          {doc.documentType && (
            <span className="inline-block rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0">
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
