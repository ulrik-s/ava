/**
 * Drizzle `DocumentRepository` (ADR 0020) — server-impl. Org-scopar via join
 * mot matters; left-joinar uppladdaren (users) för namn.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Document } from "@/lib/shared/schemas/document";
import { asId } from "@/lib/shared/schemas/ids";
import { documents, matters, users } from "../db/schema";
import type { AppDb } from "../db/types";
import type {
  DocumentAccessRow, DocumentListRow, DocumentRepository,
} from "./document-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { matterOrg } from "./matter-org";

/** documents.folderId = X, eller IS NULL för rot. */
function folderEq(folderId: string | null) {
  return folderId === null ? isNull(documents.folderId) : eq(documents.folderId, asId<"DocumentFolderId">(folderId));
}

function toListRow(r: { doc: typeof documents.$inferSelect; ubName: string | null }): DocumentListRow {
  return {
    ...r.doc,
    uploadedBy: r.ubName ? { name: r.ubName } : null,
  };
}

export class DrizzleDocumentRepository
  extends DrizzleRepository<Document>
  implements DocumentRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(documents), now);
  }

  /** Dokument saknar org-kolumn → härled via ärendet (#528) så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: string }).matterId);
  }

  async listInFolder(
    matterId: string, folderId: string | null, page: number, pageSize: number,
  ): Promise<{ documents: DocumentListRow[]; total: number }> {
    const where = and(eq(documents.matterId, asId<"MatterId">(matterId)), folderEq(folderId), isNull(documents.deletedAt));
    const rows = await this.db
      .select({ doc: documents, ubName: users.name }).from(documents)
      .leftJoin(users, eq(documents.uploadedById, users.id))
      .where(where).orderBy(desc(documents.createdAt))
      .limit(pageSize).offset((page - 1) * pageSize);
    const [agg] = await this.db
      .select({ total: sql<number>`count(*)` }).from(documents).where(where);
    return { documents: rows.map(toListRow), total: Number(agg?.total ?? 0) };
  }

  async listByMatter(matterId: string): Promise<DocumentListRow[]> {
    const rows = await this.db
      .select({ doc: documents, ubName: users.name }).from(documents)
      .leftJoin(users, eq(documents.uploadedById, users.id))
      .where(and(eq(documents.matterId, asId<"MatterId">(matterId)), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt));
    return rows.map(toListRow);
  }

  async listDocumentTypesForOrg(organizationId: string): Promise<Array<{ type: string; count: number }>> {
    const rows = await this.db
      .select({ type: documents.documentType, count: sql<number>`count(*)` })
      .from(documents).innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(eq(matters.organizationId, asId<"OrganizationId">(organizationId)), isNull(documents.deletedAt)))
      .groupBy(documents.documentType);
    return rows
      .filter((r): r is { type: string; count: number } => Boolean(r.type))
      .map((r) => ({ type: r.type, count: Number(r.count) }))
      .sort((a, b) => a.type.localeCompare(b.type, "sv"));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<DocumentAccessRow | null> {
    const rows = await this.db
      .select({ id: documents.id, matterId: documents.matterId }).from(documents)
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(eq(documents.id, asId<"DocumentId">(id)), eq(matters.organizationId, asId<"OrganizationId">(organizationId)), isNull(documents.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.id, matterId: row.matterId } : null;
  }

  async reassignFolder(fromFolderId: string, toFolderId: string | null): Promise<void> {
    await this.db.update(documents)
      .set({ folderId: toFolderId === null ? null : asId<"DocumentFolderId">(toFolderId) })
      .where(eq(documents.folderId, asId<"DocumentFolderId">(fromFolderId)));
  }
}
