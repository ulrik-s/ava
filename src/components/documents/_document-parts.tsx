"use client";

/**
 * Dokumentdelar i dokumentpanelen (#1220) — ett sammansatt dokument
 * ("kallelse + stämning + FUP" i EN PDF) visas som "Kallelse + Stämning + FUP"
 * med en expanderbar lista av delarna: sidintervall ("s. 1–2"), klick öppnar
 * dokumentet på delens första sida, och delens typ kan rättas (blir MANUAL och
 * bevaras vid omklassificering). Delgränserna går inte att flytta här — det är
 * medvetet utanför scope.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { isDocumentKind, KIND_LABELS, KNOWN_KINDS, kindLabel } from "@/lib/shared/document-kind";
import { kindsOf } from "@/lib/shared/document-part-kinds";
import type { DocumentPart } from "@/lib/shared/schemas/document";
import type { DocumentId } from "@/lib/shared/schemas/ids";

/** Det UI:t behöver av en del. */
export type DocumentPartView = Pick<DocumentPart, "id" | "kind" | "fromPage" | "toPage" | "source">;

/** Dokumentet sett av del-UI:t. */
export interface PartsDocLike {
  id: DocumentId;
  fileName: string;
  storagePath: string;
  documentType?: string | null | undefined;
  parts?: readonly DocumentPartView[] | undefined;
}

/** "Kallelse + Stämning + FUP" — etiketter, aldrig råa koder. null = ingen typ. */
export function documentKindsLabel(doc: Pick<PartsDocLike, "documentType" | "parts">): string | null {
  const kinds = kindsOf(doc);
  return kinds.length > 0 ? kinds.map(kindLabel).join(" + ") : null;
}

/** "s. 3" eller "s. 1–2". */
export function pageRangeLabel(p: Pick<DocumentPartView, "fromPage" | "toPage">): string {
  return p.fromPage === p.toPage ? `s. ${p.fromPage}` : `s. ${p.fromPage}–${p.toPage}`;
}

async function openAtPage(doc: PartsDocLike, page: number): Promise<void> {
  const { openMatterDocument } = await import("@/lib/client/firma/open-matter-document");
  await openMatterDocument({ id: doc.id, storagePath: doc.storagePath, fileName: doc.fileName }, page);
}

function PartRow({ doc, part, index }: { doc: PartsDocLike; part: DocumentPartView; index: number }) {
  const utils = trpc.useUtils();
  const setKind = trpc.document.setPartKind.useMutation({
    onSuccess: () => {
      void utils.document.partsByMatter.invalidate();
      void utils.document.tree.invalidate();
    },
  });
  return (
    <li className="flex items-center gap-2 text-xs">
      <button type="button" onClick={() => void openAtPage(doc, part.fromPage)}
        className="text-blue-600 hover:underline text-left" title={`Öppna på sidan ${part.fromPage}`}>
        {kindLabel(part.kind)} <span className="text-gray-500">{pageRangeLabel(part)}</span>
      </button>
      <select aria-label={`Rätta typ för del ${index + 1}`} value={part.kind} disabled={setKind.isPending}
        onChange={(e) => { const kind = e.target.value; if (isDocumentKind(kind)) setKind.mutate({ partId: part.id, kind }); }}
        className="border border-gray-200 rounded px-1 py-0 text-[11px] bg-white">
        {KNOWN_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
      </select>
      {part.source === "MANUAL" && <span className="text-[10px] text-gray-400" title="Typen är rättad manuellt">rättad</span>}
    </li>
  );
}

/** Expanderbar dellista under dokumentnamnet. Inget renderas utan delar. */
export function DocumentPartsList({ doc }: { doc: PartsDocLike }) {
  const [open, setOpen] = useState(false);
  const parts = doc.parts ?? [];
  if (parts.length === 0) return null;
  return (
    <div className="mt-0.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="text-[11px] text-gray-500 hover:text-gray-800">
        {open ? "▾" : "▸"} {parts.length === 1 ? "1 del" : `${parts.length} delar`}
      </button>
      {open && (
        <ul className="mt-1 ml-3 space-y-1">
          {parts.map((p, i) => <PartRow key={p.id} doc={doc} part={p} index={i} />)}
        </ul>
      )}
    </div>
  );
}

/** Hämta ärendets delar och hänge dem på dokumenten (sidordning). */
export function useDocumentsWithParts<D extends { id: DocumentId }>(matterId: DocumentPart["matterId"], documents: readonly D[]): Array<D & { parts: DocumentPartView[] }> {
  const { data } = trpc.document.partsByMatter.useQuery({ matterId });
  return useMemo(() => {
    const byDoc = new Map<string, DocumentPartView[]>();
    for (const p of data ?? []) byDoc.set(p.documentId, [...(byDoc.get(p.documentId) ?? []), p]);
    return documents.map((d) => ({ ...d, parts: byDoc.get(d.id) ?? [] }));
  }, [data, documents]);
}
