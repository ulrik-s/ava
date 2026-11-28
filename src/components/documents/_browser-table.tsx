"use client";

/**
 * Trädvyns tabell (Mapp-vy): rubriken, rot-raden som tar emot släpp och
 * tomtillståndet. Raderna ritas av `DocumentTree` i `document-browser.tsx`.
 * Utbruten ur `document-browser.tsx` (#2046), som stod vid sitt filtak.
 */

import type { DocumentRecord } from "./_document-row";
import type { FolderRecord } from "./_folder-row";

interface Props {
  rootFolders: FolderRecord[];
  rootDocs: DocumentRecord[];
  renderFolderRow: (folder: FolderRecord, depth: number) => React.ReactNode;
  renderDocRow: (doc: DocumentRecord, depth: number) => React.ReactNode;
  dropTarget: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export function BrowserTable({
  rootFolders, rootDocs, renderFolderRow, renderDocRow,
  dropTarget, onDragOver, onDragLeave, onDrop,
}: Props) {
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
