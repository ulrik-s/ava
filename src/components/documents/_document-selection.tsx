"use client";

/**
 * Markera flera dokument och flytta dem tillsammans (#2046). Listvyn markerar
 * med `DataTable`-propen `selection` (#2043), trädvyn med en kryssruta på varje
 * dokumentrad, och båda läser samma markering som dokumentvyn äger. Vad som går
 * att markera är samma regel som menyraden **Flytta till ärende…** (#2045).
 */

import { useCallback, useState } from "react";
import type { RowSelection } from "@/components/ui/data-table";
import { toggleRow } from "@/components/ui/data-table-logic";
import type { MovableDocumentFields } from "@/lib/shared/document-move";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { documentMoveDisabledReason, MoveDocumentsDialog } from "./move-documents-dialog";

/** Ett dokument som kan markeras: id:t och fälten flyttregeln läser. */
export type SelectableDocument = MovableDocumentFields & { id: string };

/** Går dokumentet att markera? Samma regel som menyraden (fakturans dokument, uppladdning). */
export function isMovableDocument(doc: MovableDocumentFields, isUploading: boolean): boolean {
  return documentMoveDisabledReason(doc, isUploading) === null;
}

/** Dokumentvyns markering: tabellens `selection` och en tömning (vybyte, efter flytten). */
export function useDocumentSelection<T extends SelectableDocument>(uploadingIds: ReadonlySet<string>): {
  selection: RowSelection<T>;
  clear: () => void;
} {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const isSelectable = useCallback((doc: T) => isMovableDocument(doc, uploadingIds.has(doc.id)), [uploadingIds]);
  return {
    selection: { selected, onChange: setSelected, isSelectable },
    clear: () => setSelected(new Set()),
  };
}

/** Trädradens kryssruta: markerad och av/på. */
export interface RowToggle {
  checked: boolean;
  onToggle: () => void;
}

/** Kryssrutan för en rad i trädvyn, eller `undefined` när raden inte går att markera. */
export function rowToggle<T extends SelectableDocument>(selection: RowSelection<T>, doc: T): RowToggle | undefined {
  if (!(selection.isSelectable?.(doc) ?? true)) return undefined;
  return {
    checked: selection.selected.has(doc.id),
    onToggle: () => selection.onChange(toggleRow(selection.selected, doc.id)),
  };
}

interface ButtonProps {
  /** De markerade dokumentens id. */
  selected: ReadonlySet<string>;
  /** Ärendet dokumenten ligger i: inte valbart. */
  matterId: MatterId;
  /** Flytten gick igenom: töm markeringen. */
  onMoved: () => void;
}

/** **Flytta till ärende… (N)** när minst ett dokument är markerat, och dialogen från #2045. */
export function MoveDocumentsButton({ selected, matterId, onMoved }: ButtonProps) {
  const [open, setOpen] = useState(false);
  if (selected.size === 0) return null;
  const ids = [...selected].map((id) => asId<"DocumentId">(id));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-blue-700 hover:underline">
        Flytta till ärende… ({selected.size})
      </button>
      {open && (
        <MoveDocumentsDialog ids={ids} excludeMatterId={matterId} open
          onClose={() => setOpen(false)} onMoved={onMoved} />
      )}
    </>
  );
}
