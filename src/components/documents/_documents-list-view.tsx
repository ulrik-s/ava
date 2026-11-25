"use client";

/**
 * `DocumentsListView` — platt sorterbar lista av alla dokument i ett ärende.
 * Alternativ vy till träd-vyn när användaren vill sortera på datum, typ, mm.
 *
 * Filnamnet är samma `DocumentNameCell` som träd-vyn (titel, analysstatus,
 * uppladdning). Klick: lease-medveten öppning (ADR 0033 §2).
 */

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { trpc } from "@/lib/client/trpc";
import { folderNamePath } from "@/lib/shared/document-folder-path";
import type { DocumentFolderId, MatterId } from "@/lib/shared/schemas/ids";
import { DocumentNameCell } from "./_document-name-cell";
import { documentKindsLabel } from "./_document-parts";
import { DocumentActions, type DocumentRecord } from "./_document-row";
import type { FolderRecord } from "./_folder-row";
import type { SyncStatus } from "./_sync-badge";
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
  /** Filer utifrån dras över listan; de hamnar i roten (#1615). */
  isDropTarget?: boolean;
  /** Dokument som laddas upp just nu: gråtonade, ej klickbara, spärrad meny. */
  uploadingIds: ReadonlySet<string>;
  /** Dokument vars AI-analys pågår ("⏳ analyseras…"). */
  analyzingIds: ReadonlySet<string>;
  /** Sant medan en analys körs: "Analysera (AI)" är spärrad, som i träd-vyn. */
  reanalyzePending: boolean;
}

const NO_SYNC: Map<string, SyncStatus> = new Map();

function folderPath(folderId: DocumentFolderId | null, folders: FolderRecord[]): string {
  return "/" + folderNamePath(folderId, folders).join("/");
}

export function DocumentsListView({
  matterId, documents, folders, docSync = NO_SYNC, onDelete, onReanalyze, isDropTarget = false,
  uploadingIds, analyzingIds, reanalyzePending,
}: Props) {
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  // Lease-medveten öppning (ADR 0033 §2) — delad med träd-vyn.
  const { openDocument, leaseModal } = useLeaseAwareOpen();

  const columns: Column<DocumentRecord>[] = [
    // `wrap`: filnamnet är det enda som ALLTID visas, så det måste få bryta
    // rader i stället för att tvinga fram horisontell scroll. `min-w-0` låter
    // cellens flex-innehåll krympa (se `DocumentNameCell`).
    { key: "fileName", label: "Filnamn", sortable: true, wrap: true, sortValue: (d) => d.fileName,
      render: (d) => (
        <div className={`min-w-0 ${uploadingIds.has(d.id) ? "opacity-60" : ""}`}>
          <DocumentNameCell doc={d} isAnalyzing={analyzingIds.has(d.id)} isUploading={uploadingIds.has(d.id)}
            syncStatus={docSync.get(d.id)} onOpen={() => void openDocument(d, setModal)} />
        </div>
      ),
    },
    // `hideBelow` (#983): listvyn visade sex kolumner även på 390 px och
    // överflödade med 456 px. Träd-vyn dolde sina sekundära kolumner < sm hela
    // tiden; nu gör listvyn det också. Kolumnerna finns kvar i sortering,
    // filtrering och kolumnmenyn — bara `display` växlar.
    { key: "documentType", label: "Typ", sortable: true, hideBelow: "sm",
      sortValue: (d) => documentKindsLabel(d) ?? "",
      render: (d) => <span className="text-sm text-gray-500">{documentKindsLabel(d) ?? "—"}</span> },
    { key: "folder", label: "Mapp", sortable: true, hideBelow: "lg",
      sortValue: (d) => folderPath(d.folderId ?? null, folders),
      render: (d) => <span className="text-sm text-gray-500 font-mono">{folderPath(d.folderId ?? null, folders)}</span> },
    { key: "uploadedBy", label: "Uppladdad av", sortable: true, hideBelow: "lg",
      sortValue: (d) => d.uploadedBy?.name ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.uploadedBy?.name ?? "—"}</span> },
    { key: "createdAt", label: "Datum", sortable: true, hideBelow: "sm",
      sortValue: (d) => new Date(d.createdAt),
      render: (d) => <span className="text-sm text-gray-500">{new Date(d.createdAt).toLocaleDateString("sv-SE")}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      // Samma meny som träd-vyn (#983) — se `DocumentActions`.
      render: (d) => (
        <DocumentActions
          doc={d}
          disabled={uploadingIds.has(d.id)}
          onExternalEdit={() => openDocument(d, setModal)}
          onReanalyze={() => onReanalyze(d.id)}
          onDelete={() => { if (confirm(`Ta bort "${d.fileName}"?`)) onDelete(d.id); }}
          reanalyzePending={reanalyzePending}
        />
      ),
    },
  ];

  // tRPC används bara via imports som passeras in — DataTable hanterar prefs
  void trpc;

  return (
    <div className={`p-2 ${isDropTarget ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""}`}>
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
          Tips: byt till <strong>Mapp-vy</strong> för att hantera mappar och drag-and-drop.
        </p>
      )}
    </div>
  );
}
