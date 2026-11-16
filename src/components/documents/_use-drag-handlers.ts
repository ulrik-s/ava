"use client";

/**
 * Drag-and-drop i dokumentvyn: flytta AVA:s egna rader (dokument → mapp,
 * mapp → mapp/rot) och, sedan #1615, släppa filer utifrån (från datorn eller
 * ett mejlprogram) på en mapp eller på roten. Utbruten ur `document-browser.tsx`.
 *
 * Filer utifrån går till namnrutan och sedan samma uppladdning som
 * **+ Ladda upp** (#1614). En AVA-rad öppnar aldrig namnrutan.
 */

import { useCallback, useState } from "react";
import type { DocumentFolderId } from "@/lib/shared/schemas/ids";
import { classifyDrop, isExternalDrag, type DragItem } from "./_drag-helpers";

/** Flyttmutationerna som en släppt AVA-rad använder. */
export interface MoveMutations {
  moveDocument: { mutate: (input: { documentId: string; folderId: string | null }) => void };
  moveFolder: { mutate: (input: { folderId: string; targetParentId: string | null }) => void };
}

/** Vad som händer när något släpps utifrån. */
export interface ExternalDrop {
  /** Filer utifrån släpptes; `folderId = null` är roten. */
  onFiles: (files: File[], folderId: DocumentFolderId | null) => void;
  /** Något utan filer (t.ex. bara text eller en länk) släpptes utifrån. */
  onUnreadable: () => void;
}

/** Flytta en AVA-rad till målet; en mapp på sig själv gör ingenting. */
function moveItem(mutations: MoveMutations, item: DragItem, target: DocumentFolderId | null): void {
  if (item.type === "document") mutations.moveDocument.mutate({ documentId: item.id, folderId: target });
  else if (item.id !== target) mutations.moveFolder.mutate({ folderId: item.id, targetParentId: target });
}

/** Drag-and-drop-state + handlers för mapparna, rot-raden och hela vyn. */
export function useDragHandlers(mutations: MoveMutations, external: ExternalDrop) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (type: "document" | "folder", id: string) => (e: React.DragEvent) => {
      setDragItem({ type, id });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${type}:${id}`);
    },
    []
  );
  const handleDragOver = useCallback(
    (targetId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragItem ? "move" : "copy";
      setDropTarget(targetId);
    },
    [dragItem]
  );
  const handleDragLeave = useCallback(() => setDropTarget(null), []);

  const handleDrop = useCallback(
    (target: DocumentFolderId | null) => (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const drop = classifyDrop(dragItem, e.dataTransfer);
      switch (drop.kind) {
        case "move": moveItem(mutations, drop.item, target); break;
        case "files": external.onFiles(drop.files, target); break;
        case "unreadable": external.onUnreadable(); break;
        default: { const never: never = drop; return never; }
      }
      setDragItem(null);
    },
    [dragItem, mutations, external]
  );

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTarget(null);
  }, []);

  /**
   * Hela vyn tar emot det som släpps utifrån: utanför en mapp blir målet
   * roten, och webbläsaren öppnar aldrig filen själv. En mapp eller rot-raden
   * som redan tagit hand om händelsen (`defaultPrevented`) vinner, och AVA:s
   * egna rader och kolumndragningar beter sig som förut.
   */
  const fromOutside = (e: React.DragEvent): boolean => !e.isDefaultPrevented() && !dragItem && isExternalDrag(e.dataTransfer);
  const rootZone = {
    onDragOver: (e: React.DragEvent) => { if (fromOutside(e)) handleDragOver("root")(e); },
    onDragLeave: handleDragLeave,
    onDrop: (e: React.DragEvent) => { if (fromOutside(e)) handleDrop(null)(e); },
  };

  return { dragItem, dropTarget, setDropTarget, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd, rootZone };
}
