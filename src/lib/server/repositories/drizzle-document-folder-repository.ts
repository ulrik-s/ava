/**
 * Drizzle `DocumentFolderRepository` (ADR 0020) — server-impl. `_count` via
 * korrelerade subqueries (documents i mappen + direkta undermappar).
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DocumentFolder } from "@/lib/shared/schemas/document";
import { asId } from "@/lib/shared/schemas/ids";
import { documentFolders, documents } from "../db/schema";
import type { AppDb } from "../db/types";
import type {
  DocumentFolderRepository, DocumentFolderWithCounts,
} from "./document-folder-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { matterOrg } from "./matter-org";

/** documentFolders.parentId = X, eller IS NULL för rot. */
function parentEq(parentId: string | null) {
  return parentId === null ? isNull(documentFolders.parentId) : eq(documentFolders.parentId, asId<"DocumentFolderId">(parentId));
}

export class DrizzleDocumentFolderRepository
  extends DrizzleRepository<DocumentFolder>
  implements DocumentFolderRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(documentFolders), now);
  }

  /** Mappar saknar org-kolumn → härled via ärendet (#528) så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: string }).matterId);
  }

  async listInParent(matterId: string, parentId: string | null): Promise<DocumentFolderWithCounts[]> {
    const rows = await this.db
      .select().from(documentFolders)
      .where(and(eq(documentFolders.matterId, asId<"MatterId">(matterId)), parentEq(parentId), isNull(documentFolders.deletedAt)))
      .orderBy(asc(documentFolders.name));
    const ids = rows.map((r) => r.id);
    // Grupperade count-queries (robustare än korrelerade subqueries, jfr #).
    const counts = await this.countsFor(ids);
    return rows.map((r): DocumentFolderWithCounts => ({
      ...r, _count: counts.get(r.id) ?? { documents: 0, children: 0 },
    }));
  }

  private async countsFor(folderIds: string[]): Promise<Map<string, { documents: number; children: number }>> {
    const out = new Map<string, { documents: number; children: number }>();
    if (folderIds.length === 0) return out;
    const docRows = await this.db
      .select({ id: documents.folderId, n: sql<number>`count(*)` }).from(documents)
      .where(and(inArray(documents.folderId, folderIds.map((i) => asId<"DocumentFolderId">(i))), isNull(documents.deletedAt)))
      .groupBy(documents.folderId);
    const childRows = await this.db
      .select({ id: documentFolders.parentId, n: sql<number>`count(*)` }).from(documentFolders)
      .where(and(inArray(documentFolders.parentId, folderIds.map((i) => asId<"DocumentFolderId">(i))), isNull(documentFolders.deletedAt)))
      .groupBy(documentFolders.parentId);
    for (const id of folderIds) out.set(id, { documents: 0, children: 0 });
    for (const r of docRows) if (r.id) out.get(r.id)!.documents = Number(r.n);
    for (const r of childRows) if (r.id) out.get(r.id)!.children = Number(r.n);
    return out;
  }

  async listByMatter(matterId: string): Promise<DocumentFolder[]> {
    const rows = await this.db
      .select().from(documentFolders)
      .where(and(eq(documentFolders.matterId, asId<"MatterId">(matterId)), isNull(documentFolders.deletedAt)))
      .orderBy(asc(documentFolders.name));
    return rows;
  }

  async reassignParent(fromParentId: string, toParentId: string | null): Promise<void> {
    await this.db.update(documentFolders)
      .set({ parentId: toParentId === null ? null : asId<"DocumentFolderId">(toParentId) })
      .where(eq(documentFolders.parentId, asId<"DocumentFolderId">(fromParentId)));
  }
}
