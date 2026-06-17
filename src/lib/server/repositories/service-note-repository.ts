/**
 * `ServiceNoteRepository` (ADR 0020, #409 fan-out) — tjänsteanteckningar (#348).
 * Org-scopas via ärendet (som routern). Bas-CRUD ärvs; `listByMatter` ger
 * ärendets noteringar med författar-subset, `getByIdInOrg` är ägarskaps-vakten.
 */

import type { ServiceNote } from "@/lib/shared/schemas/service-note";
import type { Repository } from "./types";

/** Notering + författar-subsetet listvyn visar. */
export interface ServiceNoteRow extends ServiceNote {
  author: { id: string; name: string } | null;
}

export interface ServiceNoteRepository extends Repository<ServiceNote> {
  /** Ärendets noteringar (nyaste först), org-scopat via ärendet, med författare. */
  listByMatter(matterId: string, organizationId: string): Promise<ServiceNoteRow[]>;
  /** Notering by id, org-scopad via ärendet (null om saknas/annan org/raderad). */
  getByIdInOrg(id: string, organizationId: string): Promise<ServiceNote | null>;
}
