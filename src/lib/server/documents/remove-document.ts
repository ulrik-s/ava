/**
 * Ta bort ett dokument — EN väg för användarens "Ta bort" och för dokument som
 * följer med när deras händelse ångras (#1230, kostnadsräkningen).
 *
 * Semantik (oförändrad från `document.delete`): raden tas bort via repot. I
 * webbläsarens lokala store köas det som en delete-mutation som servern
 * applicerar som tombstone (`softDelete`: deletedAt + change_log, och serverns
 * sidindex rensas), så andra klienter tappar dokumentet vid nästa pull.
 * Innehållsbytes (content-adresserade, ADR 0023) rörs inte. Sökindexet rensas
 * best-effort — ett misslyckat index-anrop ska inte fälla borttagningen.
 */

import type { DocumentId } from "@/lib/shared/schemas/ids";
import type { ISearchIndex } from "../ports";
import type { DocumentRepository } from "../repositories/document-repository";

export async function removeDocument(
  repos: { documents: Pick<DocumentRepository, "hardDelete"> }, searchIndex: Pick<ISearchIndex, "remove">, id: DocumentId,
): Promise<void> {
  await repos.documents.hardDelete(id);
  searchIndex.remove(id).catch(() => {});
}
