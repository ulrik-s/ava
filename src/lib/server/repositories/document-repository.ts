/**
 * `DocumentRepository` (ADR 0020, #409 fan-out) — dokument. Org-scopas via
 * ärendet (documents saknar egen organizationId-kolumn). Bas-CRUD ärvs;
 * list-metoderna tar med uppladdarens namn (`uploadedBy`).
 */

import type { Document } from "@/lib/shared/schemas/document";
import type { DocumentFolderId, DocumentId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Dokument + uppladdare (listvyn). */
export interface DocumentListRow extends Document {
  uploadedBy: { name: string } | null;
}

/** Smal access-projektion (assertDocAccess). */
export interface DocumentAccessRow {
  id: DocumentId;
  matterId: MatterId;
}

export interface DocumentRepository extends Repository<Document> {
  /** Paginerad lista i ett ärende/folder (createdAt desc) + total. */
  listInFolder(
    matterId: MatterId, folderId: DocumentFolderId | null, page: number, pageSize: number,
  ): Promise<{ documents: DocumentListRow[]; total: number }>;
  /** Alla dokument i ett ärende (createdAt desc) — för trädvyn. */
  listByMatter(matterId: MatterId): Promise<DocumentListRow[]>;
  /** Distinkta documentType-värden i org:en + antal per typ (namn-sorterat, sv). */
  listDocumentTypesForOrg(organizationId: OrganizationId): Promise<Array<{ type: string; count: number }>>;
  /** Dokument by id, org-scopat via ärendet. Null om saknas/annan org/raderat. */
  getByIdInOrg(id: DocumentId, organizationId: OrganizationId): Promise<DocumentAccessRow | null>;
  /** Flytta alla dokument i en folder till en annan (vid folder-radering). */
  reassignFolder(fromFolderId: DocumentFolderId, toFolderId: DocumentFolderId | null): Promise<void>;
}
