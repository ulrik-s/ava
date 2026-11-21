"use client";

import type { DocumentDirection, DocumentRecipient } from "@/lib/shared/schemas/document";
import { DOCUMENT_RECIPIENT_LABELS } from "./_document-details-input";
import { DocumentPartsList, documentKindsLabel, type PartsDocLike } from "./_document-parts";
import { SyncStatusBadge, type SyncStatus } from "./_sync-badge";

/**
 * Dokumentet sett av namncellen. Smalare än `NameCellDoc` (som uppfyller
 * den), så att cellen inte importerar raden och raden cellen (ingen cykel).
 */
export interface NameCellDoc extends PartsDocLike {
  title?: string | null | undefined;
  summary?: string | null | undefined;
  direction?: DocumentDirection | null | undefined;
  recipient?: DocumentRecipient | null | undefined;
  createdAt: string | Date;
  analyzedAt?: string | Date | null | undefined;
  analysisError?: string | null | undefined;
}

/** Props för {@link DocumentNameCell}. */
export interface DocumentNameCellProps {
  doc: NameCellDoc;
  isAnalyzing: boolean;
  /** Sant under uppladdningen: namnknappen är spärrad och märket "Laddar upp" visas. */
  isUploading?: boolean | undefined;
  /** Helperns write-back-status för dokumentet (ADR 0031): "ändringar på ingång". */
  syncStatus?: SyncStatus | undefined;
  /** Primärklick (ADR 0033 §2): vyn äger öppningen, cellen anropar bara. */
  onOpen: () => void;
}

const ANALYSIS_GRACE_MS = 5 * 60 * 1000;

const UPLOADING_TITLE = "Laddar upp — vänta tills filen är registrerad";

/**
 * Dokumentets namncell: titel, filnamn, riktning, mottagare, typ, analysstatus,
 * märket för uppladdning, synkmärket och delarna i ett sammansatt dokument.
 * Delas av dokumentvyns båda vyer (som `DocumentActions`, #983), så att de inte
 * glider isär.
 */
export function DocumentNameCell({ doc, isAnalyzing, isUploading, syncStatus, onOpen }: DocumentNameCellProps) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <DocumentNameButton doc={doc} isAnalyzing={isAnalyzing} disabled={!!isUploading} onOpen={onOpen} />
        {isUploading && <UploadingBadge />}
        <SyncStatusBadge status={syncStatus} />
      </div>
      <DocumentPartsList doc={doc} />
    </>
  );
}

/** Märket under uppladdningen (ADR 0016: filen går till servern, inte till git). */
function UploadingBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
      title={UPLOADING_TITLE}
    >
      <span className="animate-pulse">●</span> Laddar upp
    </span>
  );
}

function isWithinAnalysisGrace(doc: NameCellDoc): boolean {
  if (doc.analyzedAt || doc.analysisError) return false;
  return Date.now() - new Date(doc.createdAt).getTime() < ANALYSIS_GRACE_MS;
}

interface NameButtonProps {
  doc: NameCellDoc;
  isAnalyzing: boolean;
  disabled?: boolean;
  /** Primärklick: smart öppning (AVA Helper → FSA → browser-tab) via parent
   *  (modal-state ligger där). */
  onOpen: () => void;
}

/** Riktnings-badge (#880): inkommande (blå) / utgående (grön). Null → inget. */
function DirectionBadge({ direction }: { direction?: NameCellDoc["direction"] }) {
  if (!direction) return null;
  const incoming = direction === "INKOMMANDE";
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0 ${incoming ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}
      title={incoming ? "Inkommande dokument" : "Utgående dokument"}>
      {incoming ? "↓ Ink." : "↑ Utg."}
    </span>
  );
}

/** Mottagar-badge (#901): "till/från Domstol". Null → inget. */
function RecipientBadge({ recipient, direction }: { recipient?: NameCellDoc["recipient"]; direction?: NameCellDoc["direction"] }) {
  if (!recipient) return null;
  const label = DOCUMENT_RECIPIENT_LABELS[recipient] ?? recipient;
  const prep = direction === "INKOMMANDE" ? "från" : "till";
  return (
    <span className="inline-block rounded-full bg-gray-100 text-gray-600 px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0" title={`${prep} ${label}`}>
      {prep} {label}
    </span>
  );
}

/** Meta-raden under filnamnet (typ-badge, filnamn, analys-status). Utbruten
 *  ur DocumentNameButton — alla villkorade `&&`-render-grenar bor här.
 *  `flex-wrap`: märkena bryter rad, annars blir radens minsta bredd summan av
 *  märkena och listvyns automatiska tabellayout scrollar på mobil (#1796).
 *  Av samma skäl har filnamnet en fast minsta bredd (`w-0 min-w-16`). */
function DocumentNameMeta({ doc, isAnalyzing, isWaitingAnalysis }: { doc: NameCellDoc; isAnalyzing: boolean; isWaitingAnalysis: boolean }) {
  const kinds = documentKindsLabel(doc);
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 font-normal min-w-0">
      <DirectionBadge direction={doc.direction} />
      <RecipientBadge recipient={doc.recipient} direction={doc.direction} />
      {kinds && (
        <span className="inline-block rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium flex-shrink-0">
          {kinds}
        </span>
      )}
      {doc.title && <span className="w-0 min-w-16 grow truncate">{doc.fileName}</span>}
      {isWaitingAnalysis && <span className="text-amber-600 text-[10px]">⏳ analyseras…</span>}
      {doc.analysisError && !isAnalyzing && (
        <span className="text-red-500 text-[10px]" title={doc.analysisError}>
          ⚠ analys-fel
        </span>
      )}
    </span>
  );
}

function DocumentNameButton({ doc, isAnalyzing, disabled, onOpen }: NameButtonProps) {
  const isWaitingAnalysis = isAnalyzing || isWithinAnalysisGrace(doc);

  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onOpen(); }}
      disabled={disabled}
      // `w-full min-w-0`: en `display:flex`-knapp är shrink-to-fit och växer
      // annars till sitt max-content — 390 px i en 103 px-cell, alltså
      // horisontell scroll på mobil trots table-fixed. `break-words` på
      // text-spanen nedan hjälper inte så länge själva flex-containern är för
      // bred; den måste först få krympa. Mätt i #972.
      className="flex w-full min-w-0 items-start gap-2 text-blue-600 hover:underline text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
      title={disabled ? UPLOADING_TITLE : (doc.summary || "Öppna i extern app (PDFGear för PDF)")}
    >
      <span className="text-lg leading-tight flex-shrink-0">📄</span>
      <span className="flex flex-col min-w-0">
        <span className="font-medium break-words">{doc.title || doc.fileName}</span>
        <DocumentNameMeta doc={doc} isAnalyzing={isAnalyzing} isWaitingAnalysis={isWaitingAnalysis} />
      </span>
    </button>
  );
}
