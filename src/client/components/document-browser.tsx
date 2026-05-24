"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/client/lib/trpc";
import { FolderRow, type FolderRecord } from "./_folder-row";
import { DocumentRow, type DocumentRecord } from "./_document-row";
import { NewFolderForm } from "./_new-folder-form";
import { type DragItem } from "./_drag-helpers";

interface DocumentBrowserProps {
  matterId: string;
}

export function DocumentBrowser({ matterId }: DocumentBrowserProps) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  // Dokument-ID:n som fortfarande är mid-upload — visas men inte
  // klickbara förrän hela kedjan (FSA-write + tRPC-register +
  // invalidate) klar.
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  // Optimistiska rader: dyker upp i listan direkt när användaren väljer en
  // fil, innan FSA-write och tRPC-register hunnits. Tas bort när tree-
  // refetch klart (då dyker den "riktiga" raden upp på samma plats).
  const [pendingUploads, setPendingUploads] = useState<DocumentRecord[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const tree = trpc.document.tree.useQuery({ matterId });
  const folders: FolderRecord[] = tree.data?.folders ?? [];
  const documents: DocumentRecord[] = tree.data?.documents ?? [];

  const mutations = useDocumentMutations({
    matterId,
    documents,
    setShowNewFolder,
    setRenamingFolderId,
    setAnalyzingIds,
  });

  const foldersByParent = useMemo(() => groupBy(folders, (f) => f.parentId ?? null), [folders]);
  // Optimistiska rader läggs i root-foldern (de saknar ännu folderId).
  const docsByFolder = useMemo(
    () => groupBy([...documents, ...pendingUploads], (d) => d.folderId ?? null),
    [documents, pendingUploads]
  );

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

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
      const { isFsaSupported, loadHandle } = await import("@/client/lib/fsa/handle-store");
      if (!isFsaSupported()) {
        throw new Error(
          "Din webbläsare stödjer inte File System Access. Använd Chrome eller Edge."
        );
      }
      const handle = await loadHandle("repo-root");
      if (!handle) {
        throw new Error(
          "Ingen lokal mapp är vald. Gå till Inställningar → välj din firma-mapp och försök igen."
        );
      }

      const { uploadDocumentToFsa } = await import("@/client/lib/fsa/upload-document");
      const result = await uploadDocumentToFsa({ handle, matterId, file });

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
      } finally {
        await utils.document.tree.invalidate({ matterId });
        setUploadingIds((s) => {
          const next = new Set(s); next.delete(result.id); return next;
        });
        setPendingUploads((p) => p.filter((d) => d.id !== result.id));
      }

      // Bakgrundsjobb: AI-klassificering + text-extraktion → sökbart innehåll
      const { jobQueue } = await import("@/client/lib/jobs/job-queue");
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

  const renderDocRow = (doc: DocumentRecord, depth: number) => (
    <DocumentRow
      key={doc.id}
      doc={doc}
      depth={depth}
      isDragging={dragItem?.id === doc.id}
      isAnalyzing={analyzingIds.has(doc.id)}
      isUploading={uploadingIds.has(doc.id)}
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

  const rootFolders = foldersByParent.get(null) ?? [];
  const rootDocs = docsByFolder.get(null) ?? [];

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <BrowserHeader
        showNewFolder={() => setShowNewFolder(true)}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onUpload={handleFileUpload}
      />

      {uploadError && (
        <div className="mx-6 mt-3 p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-800 flex items-start justify-between gap-3">
          <span><strong>Uppladdning misslyckades:</strong> {uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-red-600 hover:text-red-800 text-xs"
            aria-label="Stäng felmeddelande"
          >
            ✕
          </button>
        </div>
      )}

      {showNewFolder && (
        <NewFolderForm
          isPending={mutations.createFolder.isPending}
          onSubmit={(name) => mutations.createFolder.mutate({ matterId, name, parentId: null })}
          onCancel={() => setShowNewFolder(false)}
        />
      )}

      <BrowserTable
        rootFolders={rootFolders}
        rootDocs={rootDocs}
        renderFolderRow={renderFolderRow}
        renderDocRow={renderDocRow}
        dropTarget={dropTarget}
        setDropTarget={setDropTarget}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop(null)}
      />
    </div>
  );
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
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">Namn</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Storlek</th>
            <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Datum</th>
            <th className="px-6 py-2 w-20"></th>
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
}: {
  showNewFolder: () => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold text-gray-900">Dokument</h2>
      <div className="flex items-center gap-3">
        <button onClick={showNewFolder} className="text-sm text-blue-600 hover:underline">
          + Ny mapp
        </button>
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
    fileSize: file.size,
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
    onSuccess: () => { invalidate(); setShowNewFolder(false); },
  });
  const renameFolder = trpc.document.renameFolder.useMutation({
    onSuccess: () => { invalidate(); setRenamingFolderId(null); },
  });
  const deleteFolder = trpc.document.deleteFolder.useMutation({ onSuccess: invalidate });
  const moveDocument = trpc.document.moveDocument.useMutation({ onSuccess: invalidate });
  const moveFolder = trpc.document.moveFolder.useMutation({ onSuccess: invalidate });
  const deleteDocument = trpc.document.delete.useMutation({ onSuccess: invalidate });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registerMutation = (trpc.document as any).register.useMutation({ onSuccess: invalidate });
  const createFromFsa = async (input: {
    id: string; matterId: string; fileName: string;
    mimeType: string; sizeBytes: number; storagePath: string;
  }) => {
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
    utils.document.tree.invalidate({ matterId });
    utils.document.pendingSuggestionsGrouped.invalidate({ matterId });
    utils.document.pendingSuggestions.invalidate({ matterId });
    utils.matter.getById.invalidate({ id: matterId });
  };
  const interval = setInterval(async () => {
    attempts++;
    await refresh();
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
  }, 5000);
}
