"use client";

export interface DragItem {
  type: "document" | "folder";
  id: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Vad ett släpp i dokumentvyn är (#1615): en AVA-rad som flyttas, filer
 * utifrån (från datorn eller ett mejlprogram), eller något utifrån utan filer
 * (bara text eller en länk). `files` går bara att läsa vid `drop`.
 */
export type DropKind =
  | { kind: "move"; item: DragItem }
  | { kind: "files"; files: File[] }
  | { kind: "unreadable" };

/** Avgör släppet: en pågående AVA-dragning vinner, annars filerna i `dataTransfer`. */
export function classifyDrop(item: DragItem | null, data: { files: ArrayLike<File> | null }): DropKind {
  if (item) return { kind: "move", item };
  const files = Array.from(data.files ?? []);
  return files.length > 0 ? { kind: "files", files } : { kind: "unreadable" };
}

/** Typer som något utifrån (fil, mejl, text, länk) bär; AVA:s egna kolumndragningar bär dem inte. */
const EXTERNAL_TYPES = ["Files", "text/plain", "text/uri-list", "text/html"];

/**
 * Kommer dragningen utifrån? Under `dragenter`/`dragover` är `files` alltid
 * tom i webbläsaren, så det avgörs på `types` (t.ex. `"Files"`).
 */
export function isExternalDrag(data: { types: ReadonlyArray<string> }): boolean {
  return data.types.some((t) => EXTERNAL_TYPES.includes(t));
}
