"use client";

import { Fragment, useState, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentBrowserProps {
  matterId: string;
}

interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  matterId: string;
  createdAt: string | Date;
}

interface DocumentRecord {
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

export function DocumentBrowser({ matterId }: DocumentBrowserProps) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragItem, setDragItem] = useState<{ type: "document" | "folder"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const tree = trpc.document.tree.useQuery({ matterId });

  const createFolder = trpc.document.createFolder.useMutation({
    onSuccess: () => {
      utils.document.tree.invalidate({ matterId });
      setShowNewFolder(false);
      setNewFolderName("");
    },
  });

  const renameFolder = trpc.document.renameFolder.useMutation({
    onSuccess: () => {
      utils.document.tree.invalidate({ matterId });
      setRenamingFolderId(null);
    },
  });

  const deleteFolder = trpc.document.deleteFolder.useMutation({
    onSuccess: () => {
      utils.document.tree.invalidate({ matterId });
    },
  });

  const moveDocument = trpc.document.moveDocument.useMutation({
    onSuccess: () => {
      utils.document.tree.invalidate({ matterId });
    },
  });

  const moveFolder = trpc.document.moveFolder.useMutation({
    onSuccess: () => {
      utils.document.tree.invalidate({ matterId });
    },
  });

  const deleteDocument = trpc.document.delete.useMutation({
    onSuccess: () => {
      utils.document.tree.invalidate({ matterId });
    },
  });

  const reanalyze = trpc.document.analyze.useMutation({
    onSuccess: () => {
      // Analysis runs fire-and-forget on the server; poll briefly so the UI
      // picks up the fresh metadata *and* re-surfaces newly-created PENDING
      // suggestions (parties + events) for re-godkänn/avvisa.
      const refresh = () => {
        utils.document.tree.invalidate({ matterId });
        utils.document.pendingSuggestionsGrouped.invalidate({ matterId });
        utils.document.pendingSuggestions.invalidate({ matterId });
        utils.matter.getById.invalidate({ id: matterId });
      };
      setTimeout(refresh, 4000);
      setTimeout(refresh, 12000);
    },
  });

  const folders: FolderRecord[] = tree.data?.folders ?? [];
  const documents: DocumentRecord[] = tree.data?.documents ?? [];

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, FolderRecord[]>();
    for (const f of folders) {
      const key = f.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return map;
  }, [folders]);

  const docsByFolder = useMemo(() => {
    const map = new Map<string | null, DocumentRecord[]>();
    for (const d of documents) {
      const key = d.folderId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [documents]);

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, folderId?: string | null) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("matterId", matterId);
    if (folderId) formData.append("folderId", folderId);
    await fetch("/api/documents/upload", { method: "POST", body: formData });
    utils.document.tree.invalidate({ matterId });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const handleDragStart = useCallback(
    (type: "document" | "folder", id: string) => (e: React.DragEvent) => {
      setDragItem({ type, id });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${type}:${id}`);
    },
    []
  );

  const handleDragOver = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(targetId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (targetFolderId: string | null) => (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      if (!dragItem) return;
      if (dragItem.type === "document") {
        moveDocument.mutate({ documentId: dragItem.id, folderId: targetFolderId });
      } else if (dragItem.type === "folder" && dragItem.id !== targetFolderId) {
        moveFolder.mutate({ folderId: dragItem.id, targetParentId: targetFolderId });
      }
      setDragItem(null);
    },
    [dragItem, moveDocument, moveFolder]
  );

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTarget(null);
  }, []);

  function renderFolderRow(folder: FolderRecord, depth: number) {
    const isCollapsed = collapsedFolders.has(folder.id);
    const isDropTarget = dropTarget === folder.id;
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childDocs = docsByFolder.get(folder.id) ?? [];

    return (
      <Fragment key={folder.id}>
        <tr
          draggable
          onDragStart={handleDragStart("folder", folder.id)}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver(folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop(folder.id)}
          className={`hover:bg-gray-50 ${
            isDropTarget ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""
          } ${dragItem?.id === folder.id ? "opacity-50" : ""}`}
        >
          <td className="px-6 py-2.5 text-sm">
            <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
              <button
                onClick={() => toggleFolder(folder.id)}
                className="w-5 text-gray-400 hover:text-gray-600 flex-shrink-0 text-xs"
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
              {renamingFolderId === folder.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renameValue.trim()) {
                      renameFolder.mutate({ id: folder.id, name: renameValue.trim() });
                    }
                  }}
                  className="flex items-center gap-2 flex-1"
                >
                  <span className="text-lg">📁</span>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    onBlur={() => setRenamingFolderId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenamingFolderId(null);
                    }}
                  />
                </form>
              ) : (
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="flex items-center gap-2"
                >
                  <span className="text-lg">📁</span>
                  <span className="font-medium text-gray-900">{folder.name}</span>
                </button>
              )}
            </div>
          </td>
          <td className="px-6 py-2.5 text-sm text-gray-400">&mdash;</td>
          <td className="px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">
            {new Date(folder.createdAt).toLocaleDateString("sv-SE")}
          </td>
          <td className="px-6 py-2.5 text-right">
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setRenamingFolderId(folder.id);
                  setRenameValue(folder.name);
                }}
                className="text-xs text-gray-500 hover:underline"
              >
                Byt namn
              </button>
              <button
                onClick={() => {
                  if (confirm(`Ta bort mappen "${folder.name}"? Innehållet flyttas till överliggande mapp.`)) {
                    deleteFolder.mutate({ id: folder.id });
                  }
                }}
                className="text-xs text-red-500 hover:underline"
              >
                Ta bort
              </button>
            </div>
          </td>
        </tr>
        {!isCollapsed && (
          <>
            {childFolders.map((child) => renderFolderRow(child, depth + 1))}
            {childDocs.map((doc) => renderDocumentRow(doc, depth + 1))}
          </>
        )}
      </Fragment>
    );
  }

  function renderDocumentRow(doc: DocumentRecord, depth: number) {
    return (
      <Fragment key={doc.id}>
        <tr
          draggable
          onDragStart={handleDragStart("document", doc.id)}
          onDragEnd={handleDragEnd}
          className={`hover:bg-gray-50 ${dragItem?.id === doc.id ? "opacity-50" : ""}`}
        >
          <td className="px-6 py-2.5 text-sm">
            <div style={{ paddingLeft: `${depth * 20 + 20}px` }}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/documents/${doc.id}/open`);
                    if (!res.ok) {
                      const j = await res.json().catch(() => ({ message: "Okänt fel" }));
                      alert(`Kunde inte öppna dokumentet: ${j.message ?? "okänt fel"}`);
                    }
                  } catch (err) {
                    alert(`Nätverksfel: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                className="flex items-start gap-2 text-blue-600 hover:underline text-left"
                title={doc.summary || "Öppna i extern app (PDFGear för PDF)"}
              >
                <span className="text-lg leading-tight">📄</span>
                <span className="flex flex-col min-w-0">
                  <span className="font-medium">
                    {doc.title || doc.fileName}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 font-normal">
                    {doc.documentType && (
                      <span className="inline-block rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
                        {doc.documentType}
                      </span>
                    )}
                    {doc.title && <span className="truncate">{doc.fileName}</span>}
                    {!doc.analyzedAt && !doc.analysisError &&
                      Date.now() - new Date(doc.createdAt).getTime() < 5 * 60 * 1000 && (
                      <span className="text-amber-600 text-[10px]">⏳ analyseras…</span>
                    )}
                    {doc.analysisError && (
                      <span className="text-red-500 text-[10px]" title={doc.analysisError}>
                        ⚠ analys-fel
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </div>
          </td>
          <td className="px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">
            {formatFileSize(doc.fileSize)}
          </td>
          <td className="px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">
            {new Date(doc.createdAt).toLocaleDateString("sv-SE")}
          </td>
          <td className="px-6 py-2.5 text-right whitespace-nowrap">
            <a
              href={`/api/documents/${doc.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3"
              title="Visa i webbläsaren"
            >
              👁 Visa
            </a>
            <a
              href={`/api/documents/${doc.id}/download?download=1`}
              className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3"
              title="Ladda ner"
            >
              ⬇ Ladda ner
            </a>
            <button
              onClick={() => reanalyze.mutate({ documentId: doc.id })}
              disabled={reanalyze.isPending}
              className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 disabled:opacity-50"
              title="Kör AI-analys på nytt"
            >
              🧠 Analysera
            </button>
            <button
              onClick={() => {
                if (confirm(`Ta bort "${doc.fileName}"?`)) {
                  deleteDocument.mutate({ id: doc.id });
                }
              }}
              className="text-xs text-red-500 hover:underline"
            >
              Ta bort
            </button>
          </td>
        </tr>
      </Fragment>
    );
  }

  const rootFolders = foldersByParent.get(null) ?? [];
  const rootDocs = docsByFolder.get(null) ?? [];

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-900">Dokument</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewFolder(true)}
            className="text-sm text-blue-600 hover:underline"
          >
            + Ny mapp
          </button>
          <label className="text-sm text-blue-600 hover:underline cursor-pointer">
            {uploading ? "Laddar upp..." : "+ Ladda upp"}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFileUpload(e)}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* New folder form */}
      {showNewFolder && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newFolderName.trim()) {
              createFolder.mutate({
                matterId,
                name: newFolderName.trim(),
                parentId: null,
              });
            }
          }}
          className="px-6 py-3 border-b border-gray-100 flex items-center gap-2"
        >
          <span className="text-lg">📁</span>
          <input
            type="text"
            autoFocus
            required
            placeholder="Mappnamn..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={createFolder.isPending}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Skapa
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNewFolder(false);
              setNewFolderName("");
            }}
            className="px-3 py-1.5 text-sm text-gray-600 hover:underline"
          >
            Avbryt
          </button>
        </form>
      )}

      {/* Tree table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Namn
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">
                Storlek
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">
                Datum
              </th>
              <th className="px-6 py-2 w-20"></th>
            </tr>
          </thead>

          <tbody>
            {/* Root drop target header */}
            <tr
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTarget("root");
              }}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(null)}
              className={`${
                dropTarget === "root" ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : "bg-gray-50"
              }`}
            >
              <td
                colSpan={4}
                className="px-6 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide"
              >
                Rot
              </td>
            </tr>

            {/* Root folders */}
            {rootFolders.map((folder) => renderFolderRow(folder, 0))}

            {/* Root-level documents */}
            {rootDocs.map((doc) => renderDocumentRow(doc, 0))}

            {/* Empty state */}
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
    </div>
  );
}
