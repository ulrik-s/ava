"use client";

import { Fragment } from "react";
import { formatFileSize } from "./_drag-helpers";

export interface DocumentRecord {
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

interface Props {
  doc: DocumentRecord;
  depth: number;
  isDragging: boolean;
  isAnalyzing: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  reanalyzePending: boolean;
}

const ANALYSIS_GRACE_MS = 5 * 60 * 1000;

export function DocumentRow({
  doc,
  depth,
  isDragging,
  isAnalyzing,
  onDragStart,
  onDragEnd,
  onReanalyze,
  onDelete,
  reanalyzePending,
}: Props) {
  return (
    <Fragment>
      <tr
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`hover:bg-gray-50 ${isDragging ? "opacity-50" : ""}`}
      >
        <td className="px-6 py-2.5 text-sm">
          <div style={{ paddingLeft: `${depth * 20 + 20}px` }}>
            <DocumentNameButton doc={doc} isAnalyzing={isAnalyzing} />
          </div>
        </td>
        <td className="px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">{formatFileSize(doc.fileSize)}</td>
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
            onClick={onReanalyze}
            disabled={reanalyzePending}
            className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 disabled:opacity-50"
            title="Kör AI-analys på nytt"
          >
            🧠 Analysera
          </button>
          <button onClick={onDelete} className="text-xs text-red-500 hover:underline">
            Ta bort
          </button>
        </td>
      </tr>
    </Fragment>
  );
}

function isWithinAnalysisGrace(doc: DocumentRecord): boolean {
  if (doc.analyzedAt || doc.analysisError) return false;
   
  return Date.now() - new Date(doc.createdAt).getTime() < ANALYSIS_GRACE_MS;
}

function DocumentNameButton({ doc, isAnalyzing }: { doc: DocumentRecord; isAnalyzing: boolean }) {
  const isWaitingAnalysis = isAnalyzing || isWithinAnalysisGrace(doc);

  const onClick = async () => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/open`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({ message: "Okänt fel" }));
        alert(`Kunde inte öppna dokumentet: ${j.message ?? "okänt fel"}`);
      }
    } catch (err) {
      alert(`Nätverksfel: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-2 text-blue-600 hover:underline text-left"
      title={doc.summary || "Öppna i extern app (PDFGear för PDF)"}
    >
      <span className="text-lg leading-tight">📄</span>
      <span className="flex flex-col min-w-0">
        <span className="font-medium">{doc.title || doc.fileName}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500 font-normal">
          {doc.documentType && (
            <span className="inline-block rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
              {doc.documentType}
            </span>
          )}
          {doc.title && <span className="truncate">{doc.fileName}</span>}
          {isWaitingAnalysis && <span className="text-amber-600 text-[10px]">⏳ analyseras…</span>}
          {doc.analysisError && !isAnalyzing && (
            <span className="text-red-500 text-[10px]" title={doc.analysisError}>
              ⚠ analys-fel
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
