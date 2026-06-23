/**
 * `MatterEventSuggestionRepository` (ADR 0020, #409 fan-out) — AI-extraherade
 * kalenderhändelser ur dokument. Org-scopas via dokument→ärende. Bas-CRUD ärvs.
 */

import type { MatterEventSuggestion } from "@/lib/shared/schemas/document";
import type { DocumentId, MatterEventSuggestionId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Händelse + ursprungsdokumentet (listvyn). */
export interface MatterEventSuggestionRow extends MatterEventSuggestion {
  document: { id: DocumentId; fileName: string; title: string | null };
}

export interface MatterEventSuggestionRepository extends Repository<MatterEventSuggestion> {
  /** Icke-avvisade händelser för ett ärende (startAt asc), org-scopat via dokumentet. */
  listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<MatterEventSuggestionRow[]>;
  /** Händelse by id, org-scopad via dokument→ärende. Null om saknas/annan org/raderad. */
  getByIdInOrg(id: MatterEventSuggestionId, organizationId: OrganizationId): Promise<MatterEventSuggestion | null>;
}
