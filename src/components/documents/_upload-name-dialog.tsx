"use client";

/**
 * Namnrutan före uppladdning (#1614): en dialog per fil, i tur och ordning,
 * förifylld med filens namn utan ändelse. **Spara** laddar upp filen med det
 * valda namnet i målmappen; **Avbryt** hoppar bara över den filen.
 * **+ Ladda upp** använder den inte.
 */

import { useCallback, useId, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { cleanFileName, fileExtension } from "@/lib/shared/document-file-name";
import type { DocumentFolderId } from "@/lib/shared/schemas/ids";
import type { UploadOptions } from "./_use-file-upload";

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

/** En fil som väntar på namn, med sitt mål. */
export interface NameQueueItem {
  key: number;
  file: File;
  folderId: DocumentFolderId | null;
}

/** Förifyllt namn: filens namn utan ändelse (`skiss.pdf` → `skiss`). */
export function defaultUploadName(fileName: string): string {
  const base = fileName.slice(0, fileName.length - fileExtension(fileName).length);
  return base || fileName;
}

/** Hjälptexten: det namn filen sparas som. */
function savedNameHint(input: string, original: string): string {
  const preview = cleanFileName(input, original);
  return preview ? `Sparas som: ${preview}` : "Ange ett namn.";
}

/**
 * Kön av filer som väntar på namnrutan. `enqueue(filer, målmapp)` lägger
 * filerna sist i kön; `current` är filen som visas just nu, `next()` går vidare.
 */
export function useUploadNameQueue() {
  const [items, setItems] = useState<NameQueueItem[]>([]);
  const counter = useRef(0);
  const enqueue = useCallback((files: readonly File[], folderId: DocumentFolderId | null) => {
    const added = files.map((file) => ({ key: ++counter.current, file, folderId }));
    setItems((prev) => [...prev, ...added]);
  }, []);
  const next = useCallback(() => setItems((prev) => prev.slice(1)), []);
  return { current: items[0] ?? null, enqueue, next };
}

function NameForm({ item, onSave, onNext }: {
  item: NameQueueItem;
  onSave: (file: File, options: UploadOptions) => void;
  onNext: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(() => defaultUploadName(item.file.name));
  const saved = cleanFileName(name, item.file.name);
  const save = () => { if (saved) onSave(item.file, { folderId: item.folderId, fileName: saved }); };
  return (
    <form aria-label="Namnge dokumentet" className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">Namn</label>
        <input id={id} className={INPUT} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <p className="mt-1 text-xs text-gray-500">{savedNameHint(name, item.file.name)}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onNext} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
        <button type="submit" disabled={!saved}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          Spara
        </button>
      </div>
    </form>
  );
}

/**
 * Namnrutan för den fil som står först i kön. Spara → `onSave(fil, {mapp, namn})`
 * och nästa fil; Avbryt, krysset och Esc → nästa fil utan uppladdning.
 */
export function UploadNameDialog({ item, onSave, onNext }: {
  item: NameQueueItem | null;
  onSave: (file: File, options: UploadOptions) => void;
  onNext: () => void;
}) {
  return (
    <Modal open={item !== null} title="Namnge dokumentet" onClose={onNext}>
      {item && <NameForm key={item.key} item={item} onSave={(file, options) => { onSave(file, options); onNext(); }} onNext={onNext} />}
    </Modal>
  );
}
