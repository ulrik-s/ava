/**
 * `MatterEventSuggestionRepository` (ADR 0020, #409 fan-out) — AI-extraherade
 * kalenderhändelser ur dokument. Org-scopas via dokument→ärende. Bas-CRUD ärvs.
 */

import type { MatterEventSuggestion } from "@/lib/shared/schemas/document";
import type { Repository } from "./types";

/** Händelse + ursprungsdokumentet (listvyn). */
export interface MatterEventSuggestionRow extends MatterEventSuggestion {
  document: { id: string; fileName: string; title: string | null };
}

export interface MatterEventSuggestionRepository extends Repository<MatterEventSuggestion> {
  /** Icke-avvisade händelser för ett ärende (startAt asc), org-scopat via dokumentet. */
  listForMatter(matterId: string, organizationId: string): Promise<MatterEventSuggestionRow[]>;
  /** Händelse by id, org-scopad via dokument→ärende. Null om saknas/annan org/raderad. */
  getByIdInOrg(id: string, organizationId: string): Promise<MatterEventSuggestion | null>;
}
