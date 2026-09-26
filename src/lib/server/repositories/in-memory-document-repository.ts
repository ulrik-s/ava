/**
 * In-memory `DocumentRepository` (ADR 0020) — browser/offline-impl. Delegerar
 * till query-engine:n (uploadedBy/matter-relations registrerade i relations.ts).
 */

import { groupPartsByDocument, kindCountsByName, type PartLike } from "@/lib/shared/document-part-kinds";
import type { Document } from "@/lib/shared/schemas/document";
import type {
  DocumentFolderId, DocumentId, MatterId, OrganizationId,
} from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  DocumentAccessRow, DocumentListRow, DocumentRepository,
} from "./document-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentRepoSource = Pick<IDataStore, "documents" | "documentParts">;

export class InMemoryDocumentRepository
  extends InMemoryRepository<Document>
  implements DocumentRepository {
  constructor(private readonly store: DocumentRepoSource, now?: () => Date) {
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
    })) as Array<{ id: string; documentType?: string | null; deletedAt?: unknown }>;
    // Delarnas typer räknas (#1220) — ett sammansatt dokument syns under varje dels typ.
    const parts = groupPartsByDocument((await this.store.documentParts.findMany({})) as PartLike[]);
    return kindCountsByName(docs.filter((d) => !d.deletedAt).map((d) => ({ documentType: d.documentType, parts: parts.get(d.id) })));
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
