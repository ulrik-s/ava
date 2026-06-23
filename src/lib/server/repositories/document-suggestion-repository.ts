/**
 * `DocumentSuggestionRepository` (ADR 0020, #409 fan-out) — AI-genererade
 * kontaktförslag (DocumentAnalysisSuggestion). Org-scopas via dokument→ärende.
 * Bas-CRUD ärvs (`update` sätter status/acceptedContactId); list/by-ids driver
 * accept/reject (enskilt + grupp).
 */

import type { DocumentAnalysisSuggestion } from "@/lib/shared/schemas/document";
import type { DocumentAnalysisSuggestionId, DocumentId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Förslag + ursprungsärendet (accept-flödet behöver matterId). */
export interface SuggestionWithMatter extends DocumentAnalysisSuggestion {
  document: { matterId: MatterId };
}

/** Förslag + dokument-metadata (listvyn/gruppning). */
export interface SuggestionListRow extends DocumentAnalysisSuggestion {
  document: { id: DocumentId; fileName: string; title: string | null };
}

export interface DocumentSuggestionRepository extends Repository<DocumentAnalysisSuggestion> {
  /** Förslag by id, org-scopat via dokument→ärende (med matterId). Null om saknas/annan org. */
  getByIdInOrg(id: DocumentAnalysisSuggestionId, organizationId: OrganizationId): Promise<SuggestionWithMatter | null>;
  /** Pending-förslag för ett ärende (dokument-include), sorterade createdAt. */
  listPendingForMatter(matterId: MatterId, organizationId: OrganizationId, order: "asc" | "desc"): Promise<SuggestionListRow[]>;
  /** Pending-förslag med givna id:n, org-scopat (grupp-accept). */
  listPendingByIds(ids: DocumentAnalysisSuggestionId[], organizationId: OrganizationId): Promise<SuggestionWithMatter[]>;
  /** Förslag (oavsett status) med givna id:n, org-scopat — id:n (grupp-reject-validering). */
  listByIdsInOrg(ids: DocumentAnalysisSuggestionId[], organizationId: OrganizationId): Promise<Array<{ id: DocumentAnalysisSuggestionId }>>;
  /** Sätt status (+ ev. acceptedContactId) på flera förslag (grupp). No-op vid tomma ids. */
  updateManyByIds(ids: DocumentAnalysisSuggestionId[], patch: Partial<DocumentAnalysisSuggestion>): Promise<void>;
}
