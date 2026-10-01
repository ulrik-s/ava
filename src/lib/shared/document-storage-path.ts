/**
 * Dokumentets sökväg till innehållet (#1372).
 *
 * `storagePath` pekar ut dokumentets bytes i content-store:n (ADR 0023) — på
 * servern ett git-repo som delas av alla byråer. En sökväg som klienten väljer
 * fritt kan peka på vad som helst i repot: `.git/index` (alla byråers hashar),
 * `.git/objects/…` (deras innehåll) eller en annan byrås fil. Därför tas bara
 * två slags sökvägar emot:
 *
 *   - **Rätt form:** ett filnamn direkt under `documents/content/` — börjar med
 *     bokstav eller siffra, inga snedstreck, ingen `..`, högst en filändelse.
 *   - **Dokumentets eget innehåll:** innehållsadresserad (`<sha256>` — den som
 *     känner hashen har redan innehållet, och hashar lämnar aldrig byrån) eller
 *     namngiven efter dokumentet självt: `<id>`, `pending-<id>`, `<id>.<ext>`.
 *     Andra namn (seedens `doc-pdf-01.pdf`) är setup-fält: bara admin, direkt.
 */

import { z } from "zod";

const PREFIX = "documents/content/";

/** Ett filnamn direkt under content-katalogen, med högst en filändelse. */
const STORAGE_PATH_RE = /^documents\/content\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(\.[A-Za-z0-9]{1,10})?$/;

/** Innehållsadresserad: sha256 i gemen hex (`contentStoragePath`). */
const CONTENT_ADDRESSED_RE = /^documents\/content\/[0-9a-f]{64}$/;

/** Filändelsen sist i namnet. */
const EXTENSION_RE = /\.[A-Za-z0-9]+$/;

/** En sökväg med rätt form (validerad, branded). */
export const documentStoragePathSchema = z
  .string()
  .regex(STORAGE_PATH_RE, "Ogiltig sökväg till dokumentets innehåll.")
  .brand<"DocumentStoragePath">();

/** En validerad sökväg till ett dokuments innehåll. */
export type DocumentStoragePath = z.infer<typeof documentStoragePathSchema>;

/** Har värdet rätt form? */
export function isDocumentStoragePath(value: unknown): value is DocumentStoragePath {
  return typeof value === "string" && STORAGE_PATH_RE.test(value);
}

/**
 * Pekar sökvägen på dokumentets eget innehåll? Innehållsadresserad, eller
 * namngiven efter dokumentet (`<id>`, `pending-<id>`, `<id>.<ext>`).
 */
export function isOwnStoragePath(path: DocumentStoragePath, documentId: string): boolean {
  if (CONTENT_ADDRESSED_RE.test(path)) return true;
  const name = path.slice(PREFIX.length).replace(EXTENSION_RE, "");
  return name === documentId || name === `pending-${documentId}`;
}

/** Sökvägen om den pekar på något annat än dokumentets eget innehåll, annars `undefined`. */
export function foreignStoragePath(path: DocumentStoragePath, documentId: string): DocumentStoragePath | undefined {
  return isOwnStoragePath(path, documentId) ? undefined : path;
}
