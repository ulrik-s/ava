/**
 * `DocumentFolderRepository` (ADR 0020, #409 fan-out) — dokumentmappar (träd).
 * Bas-CRUD ärvs; listvyn tar med antal dokument + undermappar (`_count`).
 */

import type { DocumentFolder } from "@/lib/shared/schemas/document";
import type { DocumentFolderId, MatterId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

/** Mapp + antal direkta dokument/undermappar (dokumentlistan). */
export interface DocumentFolderWithCounts extends DocumentFolder {
  _count: { documents: number; children: number };
}

export interface DocumentFolderRepository extends Repository<DocumentFolder> {
  /** Direkta undermappar i ett ärende/parent (namn asc) med `_count`. */
  listInParent(matterId: MatterId, parentId: DocumentFolderId | null): Promise<DocumentFolderWithCounts[]>;
  /** Alla mappar i ett ärende (namn asc) — för trädvyn. */
  listByMatter(matterId: MatterId): Promise<DocumentFolder[]>;
  /** Flytta alla direkta undermappar till en annan parent (vid radering). */
  reassignParent(fromParentId: DocumentFolderId, toParentId: DocumentFolderId | null): Promise<void>;
}
