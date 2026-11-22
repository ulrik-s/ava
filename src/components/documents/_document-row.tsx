"use client";

import { Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { DocumentId, DocumentFolderId, MatterId, UserId } from "@/lib/shared/schemas/ids";
import { DocumentDetailsDialog } from "./_document-details-dialog";
import { DocumentNameCell } from "./_document-name-cell";
import type { DocumentPartView } from "./_document-parts";
import type { SyncStatus } from "./_sync-badge";
import { ExternalEditModal, type ModalState } from "./external-edit-modal";
import { useLeaseAwareOpen } from "./use-lease-aware-open";

export interface DocumentRecord {
  id: DocumentId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  version: number;
  matterId: MatterId;
  folderId?: DocumentFolderId | null | undefined;
  uploadedById: UserId;
  createdAt: string | Date;
  uploadedBy: { name: string | null } | null;
  title?: string | null | undefined;
  /** Dokumentets typer (ADR 0038). Läses via `documentKinds` (äldre rader: documentType/tags). */
  kinds?: readonly string[] | undefined;
  kindsManual?: boolean | undefined;
  documentType?: string | null | undefined;
  /** Delar i ett sammansatt dokument (#1220), sidordning. Tom/saknas = inga delar. */
  parts?: readonly DocumentPartView[] | undefined;
  direction?: "INKOMMANDE" | "UTGAENDE" | null | undefined;
  recipient?: "DOMSTOL" | "MOTPART" | "KLIENT" | "FORSAKRING" | "MYNDIGHET" | "OVRIGT" | null | undefined;
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
  /** Helperns write-back-status för dokumentet (ADR 0031): "ändringar på ingång". */
  syncStatus?: SyncStatus | undefined;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  reanalyzePending: boolean;
}

export function DocumentRow({
  doc,
  depth,
  isDragging,
  isAnalyzing,
  isUploading,
  syncStatus,
  onDragStart,
  onDragEnd,
  onReanalyze,
  onDelete,
  reanalyzePending,
}: Props) {
  // Modal-state ligger på rad-nivå så både namncellen (primärklick)
  // och DocumentActions (kebab-meny) kan trigga "Editera externt" mot
  // samma modal.
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  // Lease-medveten öppning (ADR 0033 §2): visar "X redigerar" + Ta över / Öppna ändå.
  const { openDocument, leaseModal } = useLeaseAwareOpen();
  const triggerExternalEdit = async () => {
    // Försök först via AVA Helper (1-klicks-flow). Om helpern inte kör
    // faller vi tillbaka till befintlig ExternalEditModal (download via
    // browser + FSA-watch).
    const { tryHelperOpen, runExternalEdit } = await import("@/lib/client/firma/open-document-externally");
    const handled = await tryHelperOpen({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath });
    if (handled) return;
    setModal(await runExternalEdit({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath }));
  };
  // Primärklick: AVA Helper (native-app) → FSA → browser-tab. Samma delade
  // logik som list-vyn (open-document-externally) så vyerna inte glider isär.
  const openPrimary = async () => {
    await openDocument({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath }, setModal);
  };
  return (
    <Fragment>
      <ExternalEditModal state={modal} onClose={() => setModal({ kind: "closed" })} />
      {leaseModal}
      <tr
        draggable={!isUploading}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`align-top hover:bg-gray-50 ${isDragging ? "opacity-50" : ""} ${isUploading ? "opacity-60 pointer-events-none" : ""}`}
        title={isUploading ? "Laddar upp…" : undefined}
      >
        <td className="px-3 sm:px-6 py-2.5 text-sm">
          <div style={{ paddingLeft: `${depth * 16 + 4}px` }} className="min-w-0">
            <DocumentNameCell doc={doc} isAnalyzing={isAnalyzing} isUploading={isUploading} syncStatus={syncStatus}
              onOpen={() => void openPrimary()} />
          </div>
        </td>
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
  onEditDetails: () => void;
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
    { key: "details", label: "Redigera uppgifter…", icon: <span aria-hidden>✏️</span>, onSelect: o.onEditDetails, disabled: o.isDisabled, title: o.uploadingTitle ?? "Ändra titel, filnamn, dokumenttyp, riktning och mottagare" },
    // ADR 0027: LLM-analys är en server-förmåga → dölj affordansen utan den.
    ...(o.llm
      ? [{ key: "reanalyze", label: "Analysera (AI)", icon: <span aria-hidden>🧠</span>, onSelect: o.onReanalyze, disabled: o.isDisabled || o.reanalyzePending, title: o.uploadingTitle ?? "Kör AI-analys på nytt" }]
      : []),
    omitUndefined({ key: "delete", label: "Ta bort", icon: <Trash2 size={15} />, onSelect: o.onDelete, danger: true, disabled: o.isDisabled, title: o.uploadingTitle }) as ActionMenuItem,
  ];
}

/**
 * Dokumentets kebab-meny. EXPORTERAD sedan #983: listvyn byggde tidigare en
 * egen, kortare meny (Editera externt / Analysera igen / Ta bort) och tappade
 * därmed Öppna, Visa och Ladda ner så fort användaren växlade vy — samma
 * dokument, samma sida, olika möjligheter. Nu äger den här komponenten
 * uppsättningen, så de två vyerna inte kan glida isär igen.
 */
export function DocumentActions({
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
  const [editing, setEditing] = useState(false);
  const items = buildActionItems({
    isDisabled, reanalyzePending, viewHref, downloadHref, uploadingTitle, llm, serverMode,
    onOpenInEditor: () => void openViaServerOrGh(),
    onView: () => void openViaServerOrGh(),
    onExternal: () => void onExternalEdit(),
    onReanalyze, onDelete,
    onEditDetails: () => setEditing(true),
  });

  return (
    <>
      <ActionMenu items={items} disabled={isDisabled} label="Dokumentåtgärder" title={uploadingTitle} />
      <DocumentDetailsDialog docId={doc.id} doc={doc} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

export { DOCUMENT_RECIPIENT_LABELS } from "./_document-details-input";
