"use client";

/**
 * `DocumentsListView` — platt sorterbar lista av alla dokument i ett ärende.
 * Alternativ vy till träd-vyn när användaren vill sortera på datum, typ, mm.
 *
 * Klick på filnamnet: PDF/Office → "Editera externt" (öppnar i PDF Gear,
 * Word etc. när FSA finns). Andra filtyper → browser-tab.
 */

import { useState } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { DataTable, type Column } from "@/components/ui/data-table";
import { trpc } from "@/lib/client/trpc";
import type { DocumentRecord } from "./_document-row";
import { formatFileSize } from "./_drag-helpers";
import type { FolderRecord } from "./_folder-row";
import { ExternalEditModal, type ModalState } from "./external-edit-modal";

interface Props {
  matterId: string;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  onDelete: (id: string) => void;
  onReanalyze: (id: string) => void;
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

async function openDocumentSmart(doc: DocumentRecord, setModal: (m: ModalState) => void): Promise<void> {
  // Klient-genererade dokument (kostnadsräkning m.fl.) öppnas som blob:-URL ur
  // cachen (rehydreras från demo-slaben efter reload). Annars skulle demo-grenen
  // nedan öppna en storagePath som 404:ar på GH Pages → app:en hamnar på
  // dashboarden. (Träd-vyn gör redan detta via open-document.ts.)
  const { hasGeneratedDoc, openGeneratedDoc } = await import("@/lib/client/demo/generated-doc-cache");
  if (hasGeneratedDoc(doc.id)) { openGeneratedDoc(doc.id); return; }
  const { shouldPreferExternalEdit, runExternalEdit, tryHelperOpen } = await import("@/lib/client/firma/open-document-externally");
  if (shouldPreferExternalEdit(doc.fileName)) {
    // Försök 1-klicks via AVA Helper först (funkar i alla browsers)
    const handled = await tryHelperOpen({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath });
    if (handled) return;
    // Fallback: FSA + ExternalEditModal (Chrome/Edge med vald mapp)
    const { isFsaSupported, loadHandle } = await import("@/lib/client/fsa/handle-store");
    if (isFsaSupported() && await loadHandle("repo-root")) {
      setModal(await runExternalEdit({ id: doc.id, fileName: doc.fileName, storagePath: doc.storagePath }));
      return;
    }
  }
  // Fallback: öppna i browser-tab. Runtime-tier (#651): self-hosted via servern
  // (cache-medveten), demo via GH-Pages-blobben — ej bygg-tids-NEXT_PUBLIC_DEMO_BUILD.
  const { openMatterDocument } = await import("@/lib/client/firma/open-matter-document");
  await openMatterDocument({ id: doc.id, storagePath: doc.storagePath ?? null, fileName: doc.fileName });
}

export function DocumentsListView({ matterId, documents, folders, onDelete, onReanalyze }: Props) {
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });

  const columns: Column<DocumentRecord>[] = [
    { key: "fileName", label: "Filnamn", sortable: true, sortValue: (d) => d.fileName,
      render: (d) => (
        <button type="button" onClick={() => void openDocumentSmart(d, setModal)}
          className="text-sm font-medium text-blue-600 hover:underline text-left"
          title="PDF/Word/Excel → öppnas i extern editor om du har valt en lokal mapp">
          {d.fileName}
        </button>
      ),
    },
    { key: "documentType", label: "Typ", sortable: true,
      sortValue: (d) => d.documentType ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.documentType ?? "—"}</span> },
    { key: "folder", label: "Mapp", sortable: true,
      sortValue: (d) => folderPath(d.folderId ?? null, folders),
      render: (d) => <span className="text-sm text-gray-500 font-mono">{folderPath(d.folderId ?? null, folders)}</span> },
    { key: "uploadedBy", label: "Uppladdad av", sortable: true,
      sortValue: (d) => d.uploadedBy?.name ?? "",
      render: (d) => <span className="text-sm text-gray-500">{d.uploadedBy?.name ?? "—"}</span> },
    { key: "createdAt", label: "Datum", sortable: true,
      sortValue: (d) => new Date(d.createdAt),
      render: (d) => <span className="text-sm text-gray-500">{new Date(d.createdAt).toLocaleDateString("sv-SE")}</span> },
    { key: "sizeBytes", label: "Storlek", sortable: true, align: "right",
      sortValue: (d) => d.sizeBytes,
      render: (d) => <span className="text-sm font-mono text-gray-500">{formatFileSize(d.sizeBytes)}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (d) => {
        const items: ActionMenuItem[] = [
          { key: "external", label: "Editera externt", onSelect: () => void openDocumentSmart(d, setModal) },
          { key: "reanalyze", label: "Analysera igen", onSelect: () => onReanalyze(d.id) },
          {
            key: "delete",
            label: "Ta bort",
            danger: true,
            onSelect: () => { if (confirm(`Ta bort "${d.fileName}"?`)) onDelete(d.id); },
          },
        ];
        return <ActionMenu items={items} label="Dokumentåtgärder" />;
      },
    },
  ];

  // tRPC används bara via imports som passeras in — DataTable hanterar prefs
  void trpc;

  return (
    <div className="p-4">
      <ExternalEditModal state={modal} onClose={() => setModal({ kind: "closed" })} />
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
