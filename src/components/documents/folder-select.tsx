"use client";

/**
 * `FolderSelect` (#1974): väljer en mapp i ett ärende, eller överst utan mapp.
 * Generell: namnrutan före uppladdning använder den, och den är tänkt för
 * alla ställen där ett dokuments mapp väljs (t.ex. flytt till ett annat ärende).
 */

import { folderChoices, type FolderNode } from "@/lib/shared/document-folder-path";
import type { DocumentFolderId } from "@/lib/shared/schemas/ids";

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const ROOT = "";

/** Ett ärendes mappar (från `document.tree`), en mapp per rad. */
export type FolderSelectFolder = FolderNode<DocumentFolderId>;

/**
 * En `<select>` med **Överst, utan mapp** (`null`) först och sedan ärendets
 * mappar i trädets ordning med sökvägen som etikett. Utan mappar (eller innan
 * trädet hämtats) finns bara **Överst, utan mapp**.
 */
export function FolderSelect({ id, folders, value, onChange }: {
  id?: string;
  folders: readonly FolderSelectFolder[];
  value: DocumentFolderId | null;
  onChange: (value: DocumentFolderId | null) => void;
}) {
  const choices = folderChoices(folders);
  const select = (raw: string) => onChange(choices.find((c) => c.id === raw)?.id ?? null);
  return (
    <select id={id} className={INPUT} value={value ?? ROOT} onChange={(e) => select(e.target.value)}>
      <option value={ROOT}>Överst, utan mapp</option>
      {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}
