"use client";

import { Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { DocumentTags } from "./_document-tags";
import { formatFileSize } from "./_drag-helpers";
import { ExternalEditModal, type ModalState } from "./external-edit-modal";

export interface DocumentRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  version: number;
  matterId: string;
  folderId?: string | null | undefined;
  uploadedById: string;
  createdAt: string | Date;
  uploadedBy: { name: string | null } | null;
  title?: string | null | undefined;
  documentType?: string | null | undefined;
  tags?: readonly string[] | undefined;
  summary?: string | null | undefined;
  analyzedAt?: string | Date | null | undefined;
  analysisError?: string | null | undefined;
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
          <div style={{ paddingLeft: `${depth * 16 + 4}px` }} className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
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
            <DocumentTags documentId={doc.id} matterId={doc.matterId} tags={doc.tags ?? []} />
          </div>
        </td>
        <td className="hidden sm:table-cell px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">{formatFileSize(doc.sizeBytes)}</td>
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
/** Bygg Visa/Ladda-ner-URL:erna (demo → GH Pages, server → /api). Utbruten
 *  ur DocumentActions så komplexiteten (demo vs server + repo-parsning) bor
 *  i en egen funktion. */
function buildDocHrefs(doc: DocumentRecord): { viewHref: string; downloadHref: string } {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";
  if (!isDemo) {
    return {
      viewHref: `/api/documents/${doc.id}/download`,
      downloadHref: `/api/documents/${doc.id}/download?download=1`,
    };
  }
  const repo = process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO ?? "ulrik-s/ava-demo";
  const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
  const base = m ? `https://${m[1]}.github.io/${m[2]}` : repo.replace(/\/+$/, "");
  const rec = doc as DocumentRecord & { storagePath?: string };
  const path = rec.storagePath ?? `documents/${doc.id}`;
  const viewHref = `${base}/${path}`;
  return { viewHref, downloadHref: viewHref };
}

interface ActionItemsOpts {
  isDisabled: boolean;
  reanalyzePending: boolean;
  viewHref: string;
  downloadHref: string;
  uploadingTitle: string | undefined;
  /** LLM-kapabilitet (ADR 0027): false (demon) → "Analysera (AI)" döljs. */
  llm: boolean;
  /** Self-hosted (#651): "Visa"/"Ladda ner" öppnar via servern (cache-medveten)
   *  i st.f. en GH-Pages-href (som bara funkar i demon). */
  serverMode: boolean;
  onOpenInEditor: () => void;
  onView: () => void;
  onExternal: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
}

/** "Visa"/"Ladda ner": demo → direkt GH-href; self-hosted → hämta via servern
 *  (cache-medvetet) och öppna blob:-URL:en. */
function viewDownloadItems(o: ActionItemsOpts): ActionMenuItem[] {
  if (o.serverMode) {
    return [
      { key: "view", label: "Visa", icon: <span aria-hidden>👁</span>, onSelect: o.onView, disabled: o.isDisabled, title: o.uploadingTitle ?? "Visa i webbläsaren" },
      { key: "download", label: "Ladda ner", icon: <span aria-hidden>⬇</span>, onSelect: o.onView, disabled: o.isDisabled, title: o.uploadingTitle ?? "Hämta från servern" },
    ];
  }
  return [
    { key: "view", label: "Visa", icon: <span aria-hidden>👁</span>, href: o.viewHref, newTab: true, disabled: o.isDisabled, title: o.uploadingTitle ?? "Visa i webbläsaren" },
    { key: "download", label: "Ladda ner", icon: <span aria-hidden>⬇</span>, href: o.downloadHref, download: true, disabled: o.isDisabled, title: o.uploadingTitle ?? "Ladda ner" },
  ];
}

/** Bygg kebab-menyns rader. Utbruten ur DocumentActions — alla `uploadingTitle
 *  ?? …`-defaults bor här istället för i komponentkroppen. */
function buildActionItems(o: ActionItemsOpts): ActionMenuItem[] {
  return [
    { key: "open", label: "Öppna i webbläsaren", icon: <span aria-hidden>🖊</span>, onSelect: o.onOpenInEditor, disabled: o.isDisabled, title: o.uploadingTitle ?? "Öppna i din browser" },
    { key: "external", label: "Editera externt (PDF Gear, Preview…)", icon: <span aria-hidden>🖥</span>, onSelect: o.onExternal, disabled: o.isDisabled, title: o.uploadingTitle ?? "AVA committar dina ändringar automatiskt" },
    ...viewDownloadItems(o),
    // ADR 0027: LLM-analys är en server-förmåga → dölj affordansen utan den.
    ...(o.llm
      ? [{ key: "reanalyze", label: "Analysera (AI)", icon: <span aria-hidden>🧠</span>, onSelect: o.onReanalyze, disabled: o.isDisabled || o.reanalyzePending, title: o.uploadingTitle ?? "Kör AI-analys på nytt" }]
      : []),
    omitUndefined({ key: "delete", label: "Ta bort", icon: <Trash2 size={15} />, onSelect: o.onDelete, danger: true, disabled: o.isDisabled, title: o.uploadingTitle }) as ActionMenuItem,
  ];
}

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
  const { viewHref, downloadHref } = buildDocHrefs(doc);
  // Runtime-tier (#651): self-hosted öppnar via servern (cache-medveten), demo
  // via GH-Pages-href. Bygg-tids-NEXT_PUBLIC_DEMO_BUILD duger inte — den är sann
  // även i den lokala self-hosted-builden (→ tidigare GH-länkar i self-hosted).
  const serverMode = loadFirmaConfig().tier !== "demo";

  const openViaServerOrGh = async () => {
    const rec = doc as DocumentRecord & { storagePath?: string };
    const { openMatterDocument } = await import("@/lib/client/firma/open-matter-document");
    await openMatterDocument({ id: doc.id, storagePath: rec.storagePath ?? null, fileName: doc.fileName });
  };

  const isDisabled = !!disabled;
  const uploadingTitle = isDisabled ? "Vänta tills uppladdningen är klar" : undefined;
  const { llm } = useCapabilities();
  const items = buildActionItems({
    isDisabled, reanalyzePending, viewHref, downloadHref, uploadingTitle, llm, serverMode,
    onOpenInEditor: () => void openViaServerOrGh(),
    onView: () => void openViaServerOrGh(),
    onExternal: () => void onExternalEdit(),
    onReanalyze, onDelete,
  });

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

/** Meta-raden under filnamnet (typ-badge, filnamn, analys-status). Utbruten
 *  ur DocumentNameButton — alla villkorade `&&`-render-grenar bor här. */
function DocumentNameMeta({ doc, isAnalyzing, isWaitingAnalysis }: { doc: DocumentRecord; isAnalyzing: boolean; isWaitingAnalysis: boolean }) {
  return (
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
  );
}

function DocumentNameButton({ doc, isAnalyzing, disabled, onExternalEdit }: NameButtonProps) {
  const isWaitingAnalysis = isAnalyzing || isWithinAnalysisGrace(doc);

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
    // Runtime-tier (#651): self-hosted hämtar bytes från servern (+ cache),
    // demo öppnar GH-Pages-blobben. (Ej bygg-tids-NEXT_PUBLIC_DEMO_BUILD, som är
    // sant även i den lokala self-hosted-builden → länkade fel till GH.)
    const rec = doc as DocumentRecord & { storagePath?: string };
    const { openMatterDocument } = await import("@/lib/client/firma/open-matter-document");
    await openMatterDocument({ id: doc.id, storagePath: rec.storagePath ?? null, fileName: doc.fileName });
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
        <DocumentNameMeta doc={doc} isAnalyzing={isAnalyzing} isWaitingAnalysis={isWaitingAnalysis} />
      </span>
    </button>
  );
}
