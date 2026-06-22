"use client";

import type { inferRouterInputs } from "@trpc/server";
import { useState, useRef, useCallback, useMemo } from "react";
import { docSyncStatusMap, useHelperSyncStatus } from "@/lib/client/helper/use-helper";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DocumentRow, type DocumentRecord } from "./_document-row";
import { DocumentsListView } from "./_documents-list-view";
import { type DragItem } from "./_drag-helpers";
import { FolderRow, type FolderRecord } from "./_folder-row";
import { NewFolderForm } from "./_new-folder-form";
import type { SyncStatus } from "./_sync-badge";

type ViewMode = "tree" | "list";
const VIEW_MODE_KEY = "ava.documents.viewMode";

type RegisterInput = inferRouterInputs<AppRouter>["document"]["register"];

interface DocumentBrowserProps {
  matterId: string;
}

type DragApi = ReturnType<typeof useDragHandlers>;
interface RenameApi {
  renamingFolderId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  setRenamingFolderId: (v: string | null) => void;
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
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tree = trpc.document.tree.useQuery({ matterId });
  const folders = useMemo<FolderRecord[]>(
    () => tree.data?.folders ?? [],
    [tree.data],
  );
  const documents = useMemo<DocumentRecord[]>(
    () => tree.data?.documents ?? [],
    [tree.data],
  );

  // Per-dokument write-back-status ur AVA Helperns lokala kö (ADR 0031): markerar
  // "ändringar på ingång" så man inte återöppnar och ser gamla innehållet.
  const helperSync = useHelperSyncStatus();
  const docSync = useMemo(() => docSyncStatusMap(helperSync), [helperSync]);

  const mutations = useDocumentMutations({
    matterId,
    documents,
    setShowNewFolder,
    setRenamingFolderId,
    setAnalyzingIds,
  });
  const upload = useFileUpload({ matterId, mutations, fileInputRef });
  const drag = useDragHandlers(mutations);

  const foldersByParent = useMemo(() => groupBy(folders, (f) => f.parentId ?? null), [folders]);
  // Optimistiska rader läggs i root-foldern (de saknar ännu folderId).
  const docsByFolder = useMemo(
    () => groupBy([...documents, ...upload.pendingUploads], (d) => d.folderId ?? null),
    [documents, upload.pendingUploads]
  );

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <BrowserHeader
        showNewFolder={() => setShowNewFolder(true)}
        uploading={upload.uploading}
        fileInputRef={fileInputRef}
        onUpload={(e) => { void upload.handleFileUpload(e); }}
        viewMode={viewMode}
        onChangeViewMode={changeViewMode}
      />

      {upload.uploadError && (
        <UploadErrorBanner message={upload.uploadError} onDismiss={() => upload.setUploadError(null)} />
      )}

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
          documents={documents}
          folders={folders}
          docSync={docSync}
          onDelete={(id) => mutations.deleteDocument.mutate({ id })}
          onReanalyze={(id) => mutations.reanalyze.mutate({ documentId: id })}
        />
      )}
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
  toggleFolder: (folderId: string) => void;
  drag: DragApi;
  analyzingIds: Set<string>;
  uploadingIds: Set<string>;
  docSync: Map<string, SyncStatus>;
  rename: RenameApi;
  mutations: ReturnType<typeof useDocumentMutations>;
}) {
  const { dragItem, dropTarget, setDropTarget, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd } = drag;
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
      setDropTarget={setDropTarget}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop(null)}
    />
  );
}

/** Felbanner när en uppladdning misslyckas. */
function UploadErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mx-6 mt-3 p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-800 flex items-start justify-between gap-3">
      <span><strong>Uppladdning misslyckades:</strong> {message}</span>
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

interface UploadResult { id: string; fileName: string; mimeType: string; sizeBytes: number; storagePath: string }

/**
 * Lös var bytes hamnar: FSA (lokal working copy om ansluten) eller server-first
 * (#518) — generera id + läs bytes som laddas upp content-adresserat efter
 * register. `serverBytes` är null i FSA-fallet.
 */
async function resolveUpload(file: File, matterId: string): Promise<{ result: UploadResult; serverBytes: Uint8Array | null }> {
  const { isFsaSupported, loadHandle } = await import("@/lib/client/fsa/handle-store");
  const handle = isFsaSupported() ? await loadHandle("repo-root") : null;
  if (handle) {
    const { uploadDocumentToFsa } = await import("@/lib/client/fsa/upload-document");
    return { result: await uploadDocumentToFsa({ handle, matterId, file }), serverBytes: null };
  }
  const { uuidv7 } = await import("@/lib/shared/uuid");
  const id = uuidv7();
  return {
    result: {
      id, fileName: file.name, mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size, storagePath: `documents/content/pending-${id}`,
    },
    serverBytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * Uppladdnings-state + handler: optimistiska placeholder-rader, FSA-write,
 * tRPC-register, invalidate och bakgrundsjobb (klassificering + text-extraktion).
 */
function useFileUpload({ matterId, mutations, fileInputRef }: {
  matterId: string;
  mutations: ReturnType<typeof useDocumentMutations>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const utils = trpc.useUtils();
  const [uploading, setUploading] = useState(false);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [pendingUploads, setPendingUploads] = useState<DocumentRecord[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);

    // Optimistisk rad — användaren ser filen direkt i listan, greyed,
    // med "Lokal"-pill. Tas bort när tree-refetch klart.
    const placeholderId = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const placeholder = makePlaceholderDoc({ id: placeholderId, file, matterId });
    setPendingUploads((p) => [...p, placeholder]);
    setUploadingIds((s) => new Set(s).add(placeholderId));

    const removePlaceholder = () => {
      setPendingUploads((p) => p.filter((d) => d.id !== placeholderId));
      setUploadingIds((s) => {
        const next = new Set(s); next.delete(placeholderId); return next;
      });
    };

    try {
      const { result, serverBytes } = await resolveUpload(file, matterId);

      // Byt placeholder-id mot riktigt id så raden inte hoppar.
      setUploadingIds((s) => {
        const next = new Set(s); next.delete(placeholderId); next.add(result.id); return next;
      });
      setPendingUploads((p) => p.map((d) => (d.id === placeholderId ? { ...d, id: result.id } : d)));

      try {
        await mutations.createFromFsa({
          id: result.id,
          matterId,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          storagePath: result.storagePath,
        });
        // Server-first: ladda upp bytes (content-adresserat) efter att metadatan
        // registrerats → repekar storagePath + triggar server-klassificering.
        if (serverBytes) {
          const { saveDocumentContent } = await import("@/lib/client/backend/save-document-content");
          await saveDocumentContent(utils.client, result.id, serverBytes);
        }
      } finally {
        await utils.document.tree.invalidate({ matterId });
        setUploadingIds((s) => {
          const next = new Set(s); next.delete(result.id); return next;
        });
        setPendingUploads((p) => p.filter((d) => d.id !== result.id));
      }

      // Bakgrundsjobb: AI-klassificering + text-extraktion → sökbart innehåll
      const { jobQueue } = await import("@/lib/client/jobs/job-queue");
      jobQueue.enqueue("classify-document", `Analyserar ${result.fileName}`, {
        documentId: result.id,
        fileName: result.fileName,
        storagePath: result.storagePath,
      });
      jobQueue.enqueue("extract-text", `Extraherar text ur ${result.fileName}`, {
        documentId: result.id,
        fileName: result.fileName,
        storagePath: result.storagePath,
        mimeType: result.mimeType,
      });
    } catch (err) {
      removePlaceholder();
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      console.error("[upload]", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return { uploading, uploadingIds, pendingUploads, uploadError, setUploadError, handleFileUpload };
}

/** Drag-and-drop-state + handlers (flytta dokument/mappar). */
function useDragHandlers(mutations: ReturnType<typeof useDocumentMutations>) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (type: "document" | "folder", id: string) => (e: React.DragEvent) => {
      setDragItem({ type, id });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${type}:${id}`);
    },
    []
  );
  const handleDragOver = useCallback(
    (targetId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(targetId);
    },
    []
  );
  const handleDragLeave = useCallback(() => setDropTarget(null), []);

  const handleDrop = useCallback(
    (targetFolderId: string | null) => (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      if (!dragItem) return;
      if (dragItem.type === "document") {
        mutations.moveDocument.mutate({ documentId: dragItem.id, folderId: targetFolderId });
      } else if (dragItem.type === "folder" && dragItem.id !== targetFolderId) {
        mutations.moveFolder.mutate({ folderId: dragItem.id, targetParentId: targetFolderId });
      }
      setDragItem(null);
    },
    [dragItem, mutations.moveDocument, mutations.moveFolder]
  );

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTarget(null);
  }, []);

  return { dragItem, dropTarget, setDropTarget, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd };
}

function BrowserTable({
  rootFolders, rootDocs, renderFolderRow, renderDocRow,
  dropTarget, setDropTarget, onDragLeave, onDrop,
}: {
  rootFolders: FolderRecord[];
  rootDocs: DocumentRecord[];
  renderFolderRow: (folder: FolderRecord, depth: number) => React.ReactNode;
  renderDocRow: (doc: DocumentRecord, depth: number) => React.ReactNode;
  dropTarget: string | null;
  setDropTarget: (t: string | null) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 sm:px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Namn</th>
            <th className="hidden sm:table-cell px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Storlek</th>
            <th className="hidden sm:table-cell px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Datum</th>
            <th className="px-3 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropTarget("root");
            }}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={dropTarget === "root" ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : "bg-gray-50"}
          >
            <td colSpan={4} className="px-6 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
              Rot
            </td>
          </tr>
          {rootFolders.map((folder) => renderFolderRow(folder, 0))}
          {rootDocs.map((doc) => renderDocRow(doc, 0))}
          {rootFolders.length === 0 && rootDocs.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
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
    <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold text-gray-900">Dokument</h2>
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-md border border-gray-200 text-xs">
          <button type="button" onClick={() => onChangeViewMode("list")}
            className={`px-2 py-1 ${viewMode === "list" ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>
            Lista
          </button>
          <button type="button" onClick={() => onChangeViewMode("tree")}
            className={`px-2 py-1 ${viewMode === "tree" ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>
            Träd
          </button>
        </div>
        {viewMode === "tree" && (
          <button onClick={showNewFolder} className="text-sm text-blue-600 hover:underline">
            + Ny mapp
          </button>
        )}
        <label className="text-sm text-blue-600 hover:underline cursor-pointer">
          {uploading ? "Laddar upp..." : "+ Ladda upp"}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onUpload}
            disabled={uploading}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Bygger en placeholder-DocumentRecord för optimistisk rendering medan
 * filen håller på att skrivas till FSA + registreras via tRPC.
 * Fälten är "best-effort" — version/uploadedBy/etc bara stub-värden
 * eftersom raden ändå är disabled tills den ersätts av den riktiga.
 */
function makePlaceholderDoc({
  id, file, matterId,
}: { id: string; file: File; matterId: string }): DocumentRecord {
  return {
    id,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    storagePath: "",
    version: 1,
    matterId,
    folderId: null,
    uploadedById: "",
    createdAt: new Date().toISOString(),
    uploadedBy: { name: null },
    title: null,
    documentType: null,
    summary: null,
    analyzedAt: null,
    analysisError: null,
  };
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
  matterId: string;
  documents: DocumentRecord[];
  setShowNewFolder: (v: boolean) => void;
  setRenamingFolderId: (v: string | null) => void;
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
    },
    onSuccess: (_data, { documentId }) => {
      pollAnalysis({
        documentId,
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
  documentId: string;
  matterId: string;
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
