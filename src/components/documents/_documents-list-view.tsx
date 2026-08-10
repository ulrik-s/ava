"use client";

/**
 * `DocumentsListView` — platt sorterbar lista av alla dokument i ett ärende.
 * Alternativ vy till träd-vyn när användaren vill sortera på datum, typ, mm.
 *
 * Klick på filnamnet: PDF/Office → "Editera externt" (öppnar i PDF Gear,
 * Word etc. när FSA finns). Andra filtyper → browser-tab.
 */

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { trpc } from "@/lib/client/trpc";
import type { DocumentFolderId, MatterId } from "@/lib/shared/schemas/ids";
import { DocumentActions, type DocumentRecord } from "./_document-row";
import { formatFileSize } from "./_drag-helpers";
import type { FolderRecord } from "./_folder-row";
import { SyncStatusBadge, type SyncStatus } from "./_sync-badge";
import { ExternalEditModal, type ModalState } from "./external-edit-modal";
import { useLeaseAwareOpen } from "./use-lease-aware-open";

interface Props {
  matterId: MatterId;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  /** Per-dokument write-back-status ur AVA Helperns kö (ADR 0031). */
  docSync?: Map<string, SyncStatus>;
  onDelete: (id: string) => void;
  onReanalyze: (id: string) => void;
}

const NO_SYNC: Map<string, SyncStatus> = new Map();

function folderPath(folderId: DocumentFolderId | null, folders: FolderRecord[]): string {
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

export function DocumentsListView({ matterId, documents, folders, docSync = NO_SYNC, onDelete, onReanalyze }: Props) {
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  // Lease-medveten öppning (ADR 0033 §2) — delad med träd-vyn.
  const { openDocument, leaseModal } = useLeaseAwareOpen();

  const columns: Column<DocumentRecord>[] = [
    // `wrap`: filnamnet är det enda som ALLTID visas, så det måste få bryta
    // rader i stället för att tvinga fram horisontell scroll. `min-w-0` på både
    // flex-containern och knappen — en flex-container är shrink-to-fit och
    // växer annars till sitt max-content, vilket `break-words` inte hjälper mot.
    { key: "fileName", label: "Filnamn", sortable: true, wrap: true, sortValue: (d) => d.fileName,
      render: (d) => (
        <span className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={() => void openDocument(d, setModal)}
            className="min-w-0 break-words text-sm font-medium text-blue-600 hover:underline text-left"
            title="PDF/Word/Excel → öppnas i extern editor om du har valt en lokal mapp">
            {d.fileName}
          </button>
          <SyncStatusBadge status={docSync.get(d.id)} />
        </span>
      ),
    },
    // `hideBelow` (#983): listvyn visade sex kolumner även på 390 px och
    // överflödade med 456 px. Träd-vyn dolde sina sekundära kolumner < sm hela
    // tiden; nu gör listvyn det också. Kolumnerna finns kvar i sortering,
    // filtrering och kolumnmenyn — bara `display` växlar.
    { key: "documentType", label: "Typ", sortable: true, hideBelow: "sm",
      sortValue: (d) => d.documentType ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.documentType ?? "—"}</span> },
    { key: "folder", label: "Mapp", sortable: true, hideBelow: "lg",
      sortValue: (d) => folderPath(d.folderId ?? null, folders),
      render: (d) => <span className="text-sm text-gray-500 font-mono">{folderPath(d.folderId ?? null, folders)}</span> },
    { key: "uploadedBy", label: "Uppladdad av", sortable: true, hideBelow: "lg",
      sortValue: (d) => d.uploadedBy?.name ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.uploadedBy?.name ?? "—"}</span> },
    { key: "createdAt", label: "Datum", sortable: true, hideBelow: "sm",
      sortValue: (d) => new Date(d.createdAt),
      render: (d) => <span className="text-sm text-gray-500">{new Date(d.createdAt).toLocaleDateString("sv-SE")}</span> },
    { key: "sizeBytes", label: "Storlek", sortable: true, align: "right", hideBelow: "md",
      sortValue: (d) => d.sizeBytes,
      render: (d) => <span className="text-sm font-mono text-gray-500">{formatFileSize(d.sizeBytes)}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      // Samma meny som träd-vyn (#983) — se `DocumentActions`. `reanalyzePending`
      // är false här: listvyn har ingen egen mutation-status att spegla, och en
      // felaktigt disabled rad vore värre än en knapp som kan tryckas två gånger.
      render: (d) => (
        <DocumentActions
          doc={d}
          onExternalEdit={() => openDocument(d, setModal)}
          onReanalyze={() => onReanalyze(d.id)}
          onDelete={() => { if (confirm(`Ta bort "${d.fileName}"?`)) onDelete(d.id); }}
          reanalyzePending={false}
        />
      ),
    },
  ];

  // tRPC används bara via imports som passeras in — DataTable hanterar prefs
  void trpc;

  return (
    <div className="p-4">
      <ExternalEditModal state={modal} onClose={() => setModal({ kind: "closed" })} />
      {leaseModal}
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
