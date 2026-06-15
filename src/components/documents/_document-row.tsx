"use client";

import { Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import type { OpenDocumentDeps } from "@/lib/client/firma/open-document";
import { readFromFsa } from "@/lib/client/fsa/read-from-fsa";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { formatFileSize } from "./_drag-helpers";
import { ExternalEditModal, type ModalState } from "./external-edit-modal";

/**
 * Försök öppna dokumentet från den lokala FSA-working-copyn som blob:-URL
 * (nyligen uppladdade filer hinner inte till remote än). Returnerar `true`
 * om filen öppnades, annars `false` (→ caller faller tillbaka på GH Pages-URL).
 * Platta tidiga returer håller nästlingsdjupet under gränsen.
 */
async function tryOpenViaFsa(path: string): Promise<boolean> {
  const { isFsaSupported, loadHandle } = await import("@/lib/client/fsa/handle-store");
  if (!isFsaSupported()) return false;
  const handle = await loadHandle("repo-root");
  if (!handle) return false;
  const blob = await readFromFsa(handle, path);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Återvinn URL:n efter en stund (browsern behåller den medan tab:n öppen)
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

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
  // Modal-state ligger på rad-nivå så både DocumentNameButton (primärklick)
  // och DocumentActions (kebab-meny) kan trigga "Editera externt" mot
  // samma modal.
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const triggerExternalEdit = async () => {
    // Försök först via AVA Helper (1-klicks-flow). Om helpern inte kör
    // faller vi tillbaka till befintlig ExternalEditModal (download via
    // browser + FSA-watch).
    const { tryHelperOpen, runExternalEdit } = await import("@/lib/client/firma/open-document-externally");
    const handled = await tryHelperOpen({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath });
    if (handled) return;
    setModal(await runExternalEdit({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath }));
  };
  return (
    <Fragment>
      <ExternalEditModal state={modal} onClose={() => setModal({ kind: "closed" })} />
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
            <DocumentNameButton doc={doc} isAnalyzing={isAnalyzing} disabled={!!isUploading}
              onExternalEdit={() => void triggerExternalEdit()} />
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
            disabled={!!isUploading}
            onReanalyze={onReanalyze}
            onDelete={onDelete}
            reanalyzePending={reanalyzePending}
            onExternalEdit={triggerExternalEdit}
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
  onExternalEdit,
}: {
  doc: DocumentRecord;
  disabled?: boolean;
  onReanalyze: () => void;
  onDelete: () => void;
  reanalyzePending: boolean;
  onExternalEdit: () => Promise<void>;
}) {
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
        if (await tryOpenViaFsa(path)) return;
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

  const openExternal = onExternalEdit;

  const isDisabled = !!disabled;
  const uploadingTitle = isDisabled ? "Vänta tills uppladdningen är klar" : undefined;
  const items: ActionMenuItem[] = [
    { key: "open", label: "Öppna i webbläsaren", icon: <span aria-hidden>🖊</span>, onSelect: () => void openInEditor(), disabled: isDisabled, title: uploadingTitle ?? "Öppna i din browser" },
    { key: "external", label: "Editera externt (PDF Gear, Preview…)", icon: <span aria-hidden>🖥</span>, onSelect: () => void openExternal(), disabled: isDisabled, title: uploadingTitle ?? "AVA committar dina ändringar automatiskt" },
    { key: "view", label: "Visa", icon: <span aria-hidden>👁</span>, href: viewHref, newTab: true, disabled: isDisabled, title: uploadingTitle ?? "Visa i webbläsaren" },
    { key: "download", label: "Ladda ner", icon: <span aria-hidden>⬇</span>, href: downloadHref, download: true, disabled: isDisabled, title: uploadingTitle ?? "Ladda ner" },
    { key: "reanalyze", label: "Analysera (AI)", icon: <span aria-hidden>🧠</span>, onSelect: onReanalyze, disabled: isDisabled || reanalyzePending, title: uploadingTitle ?? "Kör AI-analys på nytt" },
    omitUndefined({ key: "delete", label: "Ta bort", icon: <Trash2 size={15} />, onSelect: onDelete, danger: true, disabled: isDisabled, title: uploadingTitle }) as ActionMenuItem,
  ];

  return <ActionMenu items={items} disabled={isDisabled} label="Dokumentåtgärder" />;
}

// readFromFsa flyttad till `@/lib/client/fsa/read-from-fsa` (delas med
// search-sidan + andra "öppna lokal kopia"-flöden).

interface NameButtonProps {
  doc: DocumentRecord;
  isAnalyzing: boolean;
  disabled?: boolean;
  /** Påkallad av PDF/Office-klick när FSA är tillgänglig: kör external-
   *  edit-flödet via parent (modal-state ligger där). Om null → faller
   *  vi alltid tillbaka till browser-tab. */
  onExternalEdit?: () => void;
}

// eslint-disable-next-line complexity
function DocumentNameButton({ doc, isAnalyzing, disabled, onExternalEdit }: NameButtonProps) {
  const isWaitingAnalysis = isAnalyzing || isWithinAnalysisGrace(doc);

  const isDemo = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";
  const onClick = async () => {
    if (disabled) return;
    // PDF/Office-filer öppnas i extern editor (PDF Gear, Preview, Word…)
    // när FSA är konfigurerad. Browser-tabben är fallback.
    if (onExternalEdit) {
      const { shouldPreferExternalEdit } = await import("@/lib/client/firma/open-document-externally");
      const { isFsaSupported, loadHandle } = await import("@/lib/client/fsa/handle-store");
      if (shouldPreferExternalEdit(doc.fileName) && isFsaSupported() && await loadHandle("repo-root")) {
        onExternalEdit();
        return;
      }
    }
    const { openDocument } = await import("@/lib/client/firma/open-document");
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
    const rec = doc as DocumentRecord & { storagePath?: string };
    const demoRepo = process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO;
    const deps: OpenDocumentDeps = {
      doc: omitUndefined({ id: doc.id, storagePath: rec.storagePath, fileName: doc.fileName }) as OpenDocumentDeps["doc"],
      isDemo,
      loadHandle: () => loadHandle("repo-root"),
      readFromHandle: readFromFsa,
      openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
      notifyError: (m) => alert(m),
      ...omitUndefined({ demoRepo }),
    };
    await openDocument(deps);
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
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
