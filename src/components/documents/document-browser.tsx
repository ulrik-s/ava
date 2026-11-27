"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { SECTION_FILL_CLASS, sectionHeaderClass } from "@/components/ui/section-tone";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDocSyncStatus } from "@/lib/client/helper/use-helper";
import { enqueueTextExtraction } from "@/lib/client/jobs/enqueue-text-extraction";
import { trpc } from "@/lib/client/trpc";
import { kindLabel } from "@/lib/shared/document-kind";
import { documentKinds } from "@/lib/shared/document-kinds";
import { asId, type DocumentFolderId, type DocumentId, type MatterId } from "@/lib/shared/schemas/ids";
import { useDocumentsWithParts } from "./_document-parts";
import { DocumentRow, DOCUMENT_RECIPIENT_LABELS, type DocumentRecord } from "./_document-row";
import { DocumentsListView } from "./_documents-list-view";
import { FolderRow, type FolderRecord } from "./_folder-row";
import { NewFolderForm } from "./_new-folder-form";
import type { SyncStatus } from "./_sync-badge";
import { UploadNameDialog, useUploadNameQueue } from "./_upload-name-dialog";
import { useDragHandlers } from "./_use-drag-handlers";
import { useFileUpload, withPendingUploads, type RegisterInput } from "./_use-file-upload";

type ViewMode = "tree" | "list";

/** Vyvalet; värdet "tree" sparas som förut, bara texten heter Mapp-vy (#1804). */
const VIEW_MODE_OPTIONS = [
  { value: "list", label: "Lista" },
  { value: "tree", label: "Mapp-vy" },
] as const satisfies readonly { value: ViewMode; label: string }[];
const VIEW_MODE_KEY = "ava.documents.viewMode";
/** Beskedet när något utan filer släpps i vyn (#1615). */
export const UNREADABLE_DROP = "Det gick inte att läsa in det du släppte. Spara filen på datorn och använd + Ladda upp.";

interface DocumentBrowserProps {
  matterId: MatterId;
}

type DragApi = ReturnType<typeof useDragHandlers>;
interface RenameApi {
  renamingFolderId: DocumentFolderId | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  setRenamingFolderId: (v: DocumentFolderId | null) => void;
}

export function DocumentBrowser({ matterId }: DocumentBrowserProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "list";
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    return stored === "tree" || stored === "list" ? stored : "list";
  });
  function changeViewMode(m: ViewMode): void {
    setViewMode(m);
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_MODE_KEY, m);
  }
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<DocumentFolderId | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tree = trpc.document.tree.useQuery({ matterId });
  const folders = useMemo<FolderRecord[]>(() => tree.data?.folders ?? [], [tree.data]);
  const treeDocuments = useMemo<DocumentRecord[]>(() => tree.data?.documents ?? [], [tree.data]);
  // Delar i sammansatta dokument (#1220) hängs på varje dokument.
  const documents = useDocumentsWithParts(matterId, treeDocuments);
  // Filter på riktning + mottagare (#901) + typ (#1220, träffar valfri del). Påverkar
  // bara VISNINGEN; mutations/lookups använder hela `documents`.
  const filter = useDocumentFilter(documents);
  const { visibleDocuments } = filter;

  // Per-dokument write-back-status ur AVA Helperns lokala kö (ADR 0031): "väntar
  // på server", transient "synkad"-bekräftelse, och "konflikt".
  const docSync = useDocSyncStatus();

  const mutations = useDocumentMutations({
    matterId,
    documents,
    setShowNewFolder,
    setRenamingFolderId,
    setAnalyzingIds,
  });
  const upload = useFileUpload({ matterId, mutations });
  // Namnrutan före uppladdning (#1614, + Ladda upp #1976): `nameQueue.enqueue(filer, mapp)` öppnar den.
  const nameQueue = useUploadNameQueue();
  // Filer utifrån (#1615) går till namnrutan och sedan samma uppladdning.
  const drag = useDragHandlers(mutations, { onFiles: nameQueue.enqueue, onUnreadable: () => upload.setUploadError(UNREADABLE_DROP) });

  const foldersByParent = useMemo(() => groupBy(folders, (f) => f.parentId ?? null), [folders]);
  // Pågående uppladdningar syns i båda vyerna, även med filter; i trädet i sin målmapp.
  const shownDocuments = useMemo(() => withPendingUploads(visibleDocuments, upload.pendingUploads), [visibleDocuments, upload.pendingUploads]);
  const docsByFolder = useMemo(() => groupBy(shownDocuments, (d) => d.folderId ?? null), [shownDocuments]);

  const toggleFolder = useCallback((folderId: DocumentFolderId) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  return (
    <div className={SECTION_FILL_CLASS} {...drag.rootZone}>
      <BrowserHeader
        showNewFolder={() => setShowNewFolder(true)}
        uploading={upload.uploading}
        fileInputRef={fileInputRef}
        onUpload={(e) => { nameQueue.enqueue(Array.from(e.target.files ?? []), null); e.target.value = ""; }}
        viewMode={viewMode}
        onChangeViewMode={changeViewMode}
      />

      <DocumentFilterBar filter={filter} totalCount={documents.length} />

      {upload.uploadError && (
        <UploadErrorBanner message={upload.uploadError} onDismiss={() => upload.setUploadError(null)} />
      )}
      <UploadNameDialog item={nameQueue.current} folders={folders} onSave={(file, options) => { void upload.enqueueUpload(file, options); }} onNext={nameQueue.next} />

      {showNewFolder && (
        <NewFolderForm
          isPending={mutations.createFolder.isPending}
          onSubmit={(name) => mutations.createFolder.mutate({ matterId, name, parentId: null })}
          onCancel={() => setShowNewFolder(false)}
        />
      )}

      {viewMode === "tree" ? (
        <DocumentTree
          foldersByParent={foldersByParent}
          docsByFolder={docsByFolder}
          collapsedFolders={collapsedFolders}
          toggleFolder={toggleFolder}
          drag={drag}
          analyzingIds={analyzingIds}
          uploadingIds={upload.uploadingIds}
          docSync={docSync}
          rename={{ renamingFolderId, renameValue, setRenameValue, setRenamingFolderId }}
          mutations={mutations}
        />
      ) : (
        <DocumentsListView
          matterId={matterId}
          documents={shownDocuments}
          folders={folders}
          uploadingIds={upload.uploadingIds} analyzingIds={analyzingIds}
          reanalyzePending={mutations.reanalyze.isPending}
          docSync={docSync}
          onDelete={(id) => mutations.deleteDocument.mutate({ id })}
          onReanalyze={(id) => mutations.reanalyze.mutate({ documentId: id })}
          isDropTarget={drag.dropTarget === "root"}
        />
      )}
    </div>
  );
}

/** Matchar dokumentet filtren? Tomt filter = allt. Typ träffar någon av dokumentets typer (ADR 0038). */
function matchesFilter(d: DocumentRecord, f: { dir: string; recipient: string; kind: string }): boolean {
  return (!f.dir || d.direction === f.dir)
    && (!f.recipient || d.recipient === f.recipient)
    && (!f.kind || documentKinds(d).includes(f.kind));
}

/** Dokumentfilter-state (#901, #1220): riktning + mottagare + typ, samt den filtrerade
 *  vyn och typerna som finns. Egen hook så DocumentBrowser håller sig under max-lines. */
function useDocumentFilter(documents: DocumentRecord[]) {
  const [dirFilter, setDirFilter] = useState<"" | "INKOMMANDE" | "UTGAENDE">("");
  const [recipientFilter, setRecipientFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const visibleDocuments = useMemo<DocumentRecord[]>(
    () => documents.filter((d) => matchesFilter(d, { dir: dirFilter, recipient: recipientFilter, kind: kindFilter })),
    [documents, dirFilter, recipientFilter, kindFilter],
  );
  const kinds = useMemo(
    () => [...new Set(documents.flatMap((d) => documentKinds(d)))].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), "sv")),
    [documents],
  );
  return { dirFilter, recipientFilter, kindFilter, setDirFilter, setRecipientFilter, setKindFilter, visibleDocuments, kinds };
}

/** Filterrad (#901, #1220): riktning + mottagare + typ, så användaren enkelt ser t.ex.
 *  vilka dokument som skickats till domstol eller innehåller en FUP. Rensa + "X av Y". */
function DocumentFilterBar({ filter, totalCount }: { filter: ReturnType<typeof useDocumentFilter>; totalCount: number }) {
  const { dirFilter: dir, recipientFilter: recipient, kindFilter: kind, setDirFilter: onDir, setRecipientFilter: onRecipient, setKindFilter: onKind } = filter;
  const shownCount = filter.visibleDocuments.length;
  const active = dir !== "" || recipient !== "" || kind !== "";
  const selectCls = "border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500";
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 text-xs flex-wrap">
      <span className="text-gray-500">Filter:</span>
      <select aria-label="Riktning" value={dir} onChange={(e) => onDir(e.target.value as "" | "INKOMMANDE" | "UTGAENDE")} className={selectCls}>
        <option value="">Alla riktningar</option>
        <option value="UTGAENDE">Utgående (skickat)</option>
        <option value="INKOMMANDE">Inkommande</option>
      </select>
      <select aria-label="Mottagare" value={recipient} onChange={(e) => onRecipient(e.target.value)} className={selectCls}>
        <option value="">Alla mottagare</option>
        {Object.entries(DOCUMENT_RECIPIENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select aria-label="Typ" value={kind} onChange={(e) => onKind(e.target.value)} className={selectCls}>
        <option value="">Alla typer</option>
        {filter.kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
      </select>
      {active && <button type="button" onClick={() => { onDir(""); onRecipient(""); onKind(""); }} className="text-blue-600 hover:underline">Rensa</button>}
      {active && <span className="text-gray-400 ml-auto">{shownCount} av {totalCount}</span>}
    </div>
  );
}

/** Träd-vyn: rekursiv mapp-/dokumentrendering med drag-and-drop + rename. */
function DocumentTree({
  foldersByParent, docsByFolder, collapsedFolders, toggleFolder,
  drag, analyzingIds, uploadingIds, docSync, rename, mutations,
}: {
  foldersByParent: Map<string | null, FolderRecord[]>;
  docsByFolder: Map<string | null, DocumentRecord[]>;
  collapsedFolders: Set<string>;
  toggleFolder: (folderId: DocumentFolderId) => void;
  drag: DragApi;
  analyzingIds: Set<string>;
  uploadingIds: Set<string>;
  docSync: Map<string, SyncStatus>;
  rename: RenameApi;
  mutations: ReturnType<typeof useDocumentMutations>;
}) {
  const { dragItem, dropTarget, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd } = drag;
  const { renamingFolderId, renameValue, setRenameValue, setRenamingFolderId } = rename;

  const renderDocRow = (doc: DocumentRecord, depth: number) => (
    <DocumentRow
      key={doc.id}
      doc={doc}
      depth={depth}
      isDragging={dragItem?.id === doc.id}
      isAnalyzing={analyzingIds.has(doc.id)}
      isUploading={uploadingIds.has(doc.id)}
      syncStatus={docSync.get(doc.id)}
      onDragStart={handleDragStart("document", doc.id)}
      onDragEnd={handleDragEnd}
      onReanalyze={() => mutations.reanalyze.mutate({ documentId: doc.id })}
      onDelete={() => {
        if (confirm(`Ta bort "${doc.fileName}"?`)) {
          mutations.deleteDocument.mutate({ id: doc.id });
        }
      }}
      reanalyzePending={mutations.reanalyze.isPending}
    />
  );

  const renderFolderRow = (folder: FolderRecord, depth: number): React.ReactNode => {
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childDocs = docsByFolder.get(folder.id) ?? [];
    return (
      <FolderRow
        key={folder.id}
        folder={folder}
        depth={depth}
        isCollapsed={collapsedFolders.has(folder.id)}
        isDropTarget={dropTarget === folder.id}
        isDragging={dragItem?.id === folder.id}
        isRenaming={renamingFolderId === folder.id}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        onToggle={() => toggleFolder(folder.id)}
        onDragStart={handleDragStart("folder", folder.id)}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver(folder.id)}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop(folder.id)}
        onRenameSubmit={() => {
          if (renameValue.trim()) {
            mutations.renameFolder.mutate({ id: folder.id, name: renameValue.trim() });
          }
        }}
        onRenameCancel={() => setRenamingFolderId(null)}
        onStartRename={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name); }}
        onDelete={() => {
          if (confirm(`Ta bort mappen "${folder.name}"? Innehållet flyttas till överliggande mapp.`)) {
            mutations.deleteFolder.mutate({ id: folder.id });
          }
        }}
      >
        {childFolders.map((child) => renderFolderRow(child, depth + 1))}
        {childDocs.map((doc) => renderDocRow(doc, depth + 1))}
      </FolderRow>
    );
  };

  return (
    <BrowserTable
      rootFolders={foldersByParent.get(null) ?? []}
      rootDocs={docsByFolder.get(null) ?? []}
      renderFolderRow={renderFolderRow}
      renderDocRow={renderDocRow}
      dropTarget={dropTarget}
      onDragOver={handleDragOver("root")}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop(null)}
    />
  );
}

/** Felbanner när en uppladdning misslyckas. */
function UploadErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mx-2 mt-2 p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-800 flex items-start justify-between gap-3">
      <span className="whitespace-pre-line"><strong>Uppladdning misslyckades:</strong> {message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-red-600 hover:text-red-800 text-xs"
        aria-label="Stäng felmeddelande"
      >
        ✕
      </button>
    </div>
  );
}

function BrowserTable({
  rootFolders, rootDocs, renderFolderRow, renderDocRow,
  dropTarget, onDragOver, onDragLeave, onDrop,
}: {
  rootFolders: FolderRecord[];
  rootDocs: DocumentRecord[];
  renderFolderRow: (folder: FolderRecord, depth: number) => React.ReactNode;
  renderDocRow: (doc: DocumentRecord, depth: number) => React.ReactNode;
  dropTarget: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 sm:px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Namn</th>
            <th className="hidden sm:table-cell px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Datum</th>
            <th className="px-3 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={dropTarget === "root" ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : "bg-gray-50"}
          >
            <td colSpan={3} className="px-6 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
              Rot
            </td>
          </tr>
          {rootFolders.map((folder) => renderFolderRow(folder, 0))}
          {rootDocs.map((doc) => renderDocRow(doc, 0))}
          {rootFolders.length === 0 && rootDocs.length === 0 && (
            <tr>
              <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">
                Inga dokument eller mappar.
                <br />
                <span className="text-xs text-gray-400">
                  Ladda upp filer eller skapa en mapp.
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BrowserHeader({
  showNewFolder,
  uploading,
  fileInputRef,
  onUpload,
  viewMode,
  onChangeViewMode,
}: {
  showNewFolder: () => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
}) {
  return (
    <div className={sectionHeaderClass("purple", "flex flex-wrap items-center justify-between gap-2")}>
      <h2 className="font-semibold text-gray-900">Dokument</h2>
      <div className="flex items-center gap-3">
        <SegmentedControl options={VIEW_MODE_OPTIONS} value={viewMode} onChange={onChangeViewMode} ariaLabel="Dokumentvy" />
        {viewMode === "tree" && (
          <button onClick={showNewFolder} className="text-sm text-blue-700 hover:underline">
            + Ny mapp
          </button>
        )}
        <label className="text-sm text-blue-700 hover:underline cursor-pointer">
          {uploading ? "Laddar upp..." : "+ Ladda upp"}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onUpload}
            disabled={uploading}
          />
        </label>
      </div>
    </div>
  );
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function useDocumentMutations({
  matterId,
  documents,
  setShowNewFolder,
  setRenamingFolderId,
  setAnalyzingIds,
}: {
  matterId: MatterId;
  documents: DocumentRecord[];
  setShowNewFolder: (v: boolean) => void;
  setRenamingFolderId: (v: DocumentFolderId | null) => void;
  setAnalyzingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.document.tree.invalidate({ matterId });

  const createFolder = trpc.document.createFolder.useMutation({
    onSuccess: () => { void invalidate(); setShowNewFolder(false); },
  });
  const renameFolder = trpc.document.renameFolder.useMutation({
    onSuccess: () => { void invalidate(); setRenamingFolderId(null); },
  });
  const deleteFolder = trpc.document.deleteFolder.useMutation({ onSuccess: invalidate });
  const moveDocument = trpc.document.moveDocument.useMutation({ onSuccess: invalidate });
  const moveFolder = trpc.document.moveFolder.useMutation({ onSuccess: invalidate });
  const deleteDocument = trpc.document.delete.useMutation({ onSuccess: invalidate });

  const registerMutation = trpc.document.register.useMutation({ onSuccess: invalidate });
  const createFromFsa = async (input: RegisterInput) => {
    await registerMutation.mutateAsync(input);
  };

  const reanalyze = trpc.document.analyze.useMutation({
    onMutate: ({ documentId }) => {
      setAnalyzingIds((prev) => new Set(prev).add(documentId));
      // "Analysera (AI)" ska ge samma resultat som en uppladdning — inklusive
      // kontakt-/händelseförslag (#988). Porten köar bara klassificeringen, så
      // text-extraktionen köas här där dokumentets filnamn och sökväg finns.
      void enqueueTextExtraction(documents.find((d) => d.id === documentId));
    },
    onSuccess: (_data, { documentId }) => {
      pollAnalysis({
        documentId: asId<"DocumentId">(documentId),
        matterId,
        documents,
        utils,
        clearAnalyzing: () =>
          setAnalyzingIds((prev) => {
            if (!prev.has(documentId)) return prev;
            const next = new Set(prev);
            next.delete(documentId);
            return next;
          }),
      });
    },
    onError: (_err, { documentId }) => {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
    },
  });

  return { createFolder, renameFolder, deleteFolder, moveDocument, moveFolder, deleteDocument, reanalyze, createFromFsa };
}

function pollAnalysis({
  documentId,
  matterId,
  documents,
  utils,
  clearAnalyzing,
}: {
  documentId: DocumentId;
  matterId: MatterId;
  documents: DocumentRecord[];
  utils: ReturnType<typeof trpc.useUtils>;
  clearAnalyzing: () => void;
}) {
  let attempts = 0;
  const maxAttempts = 24; // 24 × 5s = 120s
  const before = documents.find((d) => d.id === documentId);
  const refresh = () => {
    void utils.document.tree.invalidate({ matterId });
    void utils.document.pendingSuggestionsGrouped.invalidate({ matterId });
    void utils.document.pendingSuggestions.invalidate({ matterId });
    void utils.matter.getById.invalidate({ id: matterId });
  };
  const interval = setInterval(() => {
    void (async () => {
      attempts++;
      refresh();
      const fresh = await utils.document.tree.fetch({ matterId });
      const doc = fresh.documents.find((d) => d.id === documentId);
      const changed = doc && before && (
        (doc.analyzedAt ? new Date(doc.analyzedAt).getTime() : 0) >
        (before.analyzedAt ? new Date(before.analyzedAt).getTime() : 0)
      );
      if (changed || attempts >= maxAttempts) {
        clearInterval(interval);
        clearAnalyzing();
      }
    })();
  }, 5000);
}
