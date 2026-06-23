/**
 * `DocumentTemplateRepository` (ADR 0020, #409 fan-out) — dokumentmallar.
 * Org-scopas direkt. Bas-CRUD ärvs; list/detalj tar med skaparens namn.
 */

import type { DocumentTemplateId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { DocumentTemplate } from "@/lib/shared/schemas/misc";
import type { Repository } from "./types";

/** Mall + skapare (detaljvyn). */
export interface DocumentTemplateRow extends DocumentTemplate {
  createdBy: { name: string } | null;
}

/** Listrad (smal projektion, utan content). */
export interface DocumentTemplateListRow {
  id: DocumentTemplateId;
  name: string;
  description: string | null;
  category: string | null;
  createdAt: Date | string;
  updatedAt: Date | string | null;
  createdBy: { name: string } | null;
}

export interface DocumentTemplateRepository extends Repository<DocumentTemplate> {
  /** Org:ens mallar (kategori asc, namn asc), smal projektion med skapar-namn. */
  listForOrg(organizationId: OrganizationId): Promise<DocumentTemplateListRow[]>;
  /** Mall by id, org-scopad, med skapare. Null om saknas/annan org/raderad. */
  getByIdInOrg(id: DocumentTemplateId, organizationId: OrganizationId): Promise<DocumentTemplateRow | null>;
}
