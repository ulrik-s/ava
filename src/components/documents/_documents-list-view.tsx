"use client";

/**
 * `DocumentsListView` — platt sorterbar lista av alla dokument i ett ärende.
 * Alternativ vy till träd-vyn när användaren vill sortera på datum, typ, mm.
 */

import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatFileSize } from "./_drag-helpers";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import type { DocumentRecord } from "./_document-row";
import type { FolderRecord } from "./_folder-row";

interface Props {
  matterId: string;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  onDelete: (id: string) => void;
  onReanalyze: (id: string) => void;
  onOpen?: (doc: DocumentRecord) => void;
}

function folderPath(folderId: string | null, folders: FolderRecord[]): string {
  if (!folderId) return "/";
  const parts: string[] = [];
  let current: FolderRecord | undefined = folders.find((f) => f.id === folderId);
  while (current) {
    parts.unshift(current.name);
    const parentId = current.parentId;
    current = parentId ? folders.find((f) => f.id === parentId) : undefined;
  }
  return "/" + parts.join("/");
}

export function DocumentsListView({ matterId, documents, folders, onDelete, onReanalyze, onOpen }: Props) {
  const columns: Column<DocumentRecord>[] = [
    { key: "fileName", label: "Filnamn", sortable: true, sortValue: (d) => d.fileName,
      render: (d) => onOpen ? (
        <button type="button" onClick={() => onOpen(d)}
          className="text-sm font-medium text-blue-600 hover:underline text-left">
          {d.fileName}
        </button>
      ) : (
        <span className="text-sm text-gray-900">{d.fileName}</span>
      ),
    },
    { key: "documentType", label: "Typ", sortable: true,
      sortValue: (d) => d.documentType ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.documentType ?? "—"}</span> },
    { key: "folder", label: "Mapp", sortable: true,
      sortValue: (d) => folderPath(d.folderId, folders),
      render: (d) => <span className="text-sm text-gray-500 font-mono">{folderPath(d.folderId, folders)}</span> },
    { key: "uploadedBy", label: "Uppladdad av", sortable: true,
      sortValue: (d) => d.uploadedBy?.name ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.uploadedBy?.name ?? "—"}</span> },
    { key: "createdAt", label: "Datum", sortable: true,
      sortValue: (d) => new Date(d.createdAt),
      render: (d) => <span className="text-sm text-gray-500">{new Date(d.createdAt).toLocaleDateString("sv-SE")}</span> },
    { key: "fileSize", label: "Storlek", sortable: true, align: "right",
      sortValue: (d) => d.fileSize,
      render: (d) => <span className="text-sm font-mono text-gray-500">{formatFileSize(d.fileSize)}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (d) => {
        const items: ActionMenuItem[] = [
          { key: "reanalyze", label: "Analysera igen", onSelect: () => onReanalyze(d.id) },
          {
            key: "delete",
            label: "Ta bort",
            danger: true,
            onSelect: () => { if (confirm(`Ta bort "${d.fileName}"?`)) onDelete(d.id); },
          },
        ];
        return <ActionMenu items={items} />;
      },
    },
  ];

  return (
    <div className="p-4">
      <DataTable
        prefKey={`list.matter-documents.${matterId}`}
        columns={columns}
        data={documents}
        rowKey={(d) => d.id}
        emptyMessage="Inga dokument."
      />
      {folders.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          Tips: byt till <strong>Träd</strong>-vy för att hantera mappar och drag-and-drop.
        </p>
      )}
    </div>
  );
}
