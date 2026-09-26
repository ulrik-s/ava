/**
 * `DocumentPartRepository` (ADR 0020, #1220) — delar av sammansatta dokument
 * (kategori + sidintervall). Matter-scopad via `matterId` (speglar dokumentets
 * ärende) så change_log får rätt org (#528-fällan). Bas-CRUD ärvs.
 */

import type { DocumentPart } from "@/lib/shared/schemas/document";
import type { DocumentId, MatterId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

export interface DocumentPartRepository extends Repository<DocumentPart> {
  /** Levande delar i ett dokument, sorterade på `fromPage`. */
  listForDocument(documentId: DocumentId): Promise<DocumentPart[]>;
  /** Levande delar för alla dokument i ett ärende (dokumentträdet), sorterade på `fromPage`. */
  listByMatter(matterId: MatterId): Promise<DocumentPart[]>;
}

/** Sortering på sidordning — delarna i ett dokument är disjunkta intervall. */
export function byFromPage(a: Pick<DocumentPart, "fromPage">, b: Pick<DocumentPart, "fromPage">): number {
  return a.fromPage - b.fromPage;
}
