/**
 * `DocumentRepository` (ADR 0020, #409 fan-out) — dokument. Org-scopas via
 * ärendet (documents saknar egen organizationId-kolumn). Bas-CRUD ärvs;
 * list-metoderna tar med uppladdarens namn (`uploadedBy`).
 */

import type { Document } from "@/lib/shared/schemas/document";
import type { Repository } from "./types";

/** Dokument + uppladdare (listvyn). */
export interface DocumentListRow extends Document {
  uploadedBy: { name: string } | null;
}

/** Smal access-projektion (assertDocAccess). */
export interface DocumentAccessRow {
  id: string;
  matterId: string;
}

export interface DocumentRepository extends Repository<Document> {
  /** Paginerad lista i ett ärende/folder (createdAt desc) + total. */
  listInFolder(
    matterId: string, folderId: string | null, page: number, pageSize: number,
  ): Promise<{ documents: DocumentListRow[]; total: number }>;
  /** Alla dokument i ett ärende (createdAt desc) — för trädvyn. */
  listByMatter(matterId: string): Promise<DocumentListRow[]>;
  /** Distinkta documentType-värden i org:en + antal per typ (namn-sorterat, sv). */
  listDocumentTypesForOrg(organizationId: string): Promise<Array<{ type: string; count: number }>>;
  /** Dokument by id, org-scopat via ärendet. Null om saknas/annan org/raderat. */
  getByIdInOrg(id: string, organizationId: string): Promise<DocumentAccessRow | null>;
  /** Flytta alla dokument i en folder till en annan (vid folder-radering). */
  reassignFolder(fromFolderId: string, toFolderId: string | null): Promise<void>;
}
