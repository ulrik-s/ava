/**
 * In-memory `DocumentRepository` (ADR 0020) — browser/offline-impl. Delegerar
 * till query-engine:n (uploadedBy/matter-relations registrerade i relations.ts).
 */

import type { Document } from "@/lib/shared/schemas/document";
import type {
  DocumentFolderId, DocumentId, MatterId, OrganizationId,
} from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  DocumentAccessRow, DocumentListRow, DocumentRepository,
} from "./document-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentRepoSource = Pick<IDataStore, "documents">;

export class InMemoryDocumentRepository
  extends InMemoryRepository<Document>
  implements DocumentRepository {
  constructor(store: DocumentRepoSource, now?: () => Date) {
    super(store.documents, now ?? (() => new Date()));
  }

  async listInFolder(
    matterId: MatterId, folderId: DocumentFolderId | null, page: number, pageSize: number,
  ): Promise<{ documents: DocumentListRow[]; total: number }> {
    const where = { matterId, folderId };
    const [documents, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { uploadedBy: { select: { name: true } } },
      }) as Promise<DocumentListRow[]>,
      this.delegate.count({ where }),
    ]);
    return { documents, total };
  }

  async listByMatter(matterId: MatterId): Promise<DocumentListRow[]> {
    return (await this.delegate.findMany({
      where: { matterId },
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { name: true } } },
    })) as DocumentListRow[];
  }

  async listDocumentTypesForOrg(organizationId: OrganizationId): Promise<Array<{ type: string; count: number }>> {
    const docs = (await this.delegate.findMany({
      where: { matter: { organizationId } },
    })) as Array<{ documentType?: string | null }>;
    const counts = new Map<string, number>();
    for (const d of docs) {
      if (!d.documentType) continue;
      counts.set(d.documentType, (counts.get(d.documentType) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type, "sv"));
  }

  async getByIdInOrg(id: DocumentId, organizationId: OrganizationId): Promise<DocumentAccessRow | null> {
    const row = (await this.delegate.findFirst({
      where: { id, matter: { organizationId } },
      select: { id: true, matterId: true, deletedAt: true },
    })) as (DocumentAccessRow & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? { id: row.id, matterId: row.matterId } : null;
  }

  async reassignFolder(fromFolderId: DocumentFolderId, toFolderId: DocumentFolderId | null): Promise<void> {
    await this.delegate.updateMany({
      where: { folderId: fromFolderId },
      data: { folderId: toFolderId } as Partial<Document>,
    });
  }
}
