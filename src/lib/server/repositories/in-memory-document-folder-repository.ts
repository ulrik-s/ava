/**
 * In-memory `DocumentFolderRepository` (ADR 0020) — browser/offline-impl.
 * `_count` (documents/children) resolveras via relations.ts.
 */

import type { DocumentFolder } from "@/lib/shared/schemas/document";
import type { DocumentFolderId, MatterId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  DocumentFolderRepository, DocumentFolderWithCounts,
} from "./document-folder-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentFolderRepoSource = Pick<IDataStore, "documentFolders">;

export class InMemoryDocumentFolderRepository
  extends InMemoryRepository<DocumentFolder>
  implements DocumentFolderRepository {
  constructor(store: DocumentFolderRepoSource, now?: () => Date) {
    super(store.documentFolders, now ?? (() => new Date()));
  }

  async listInParent(matterId: MatterId, parentId: DocumentFolderId | null): Promise<DocumentFolderWithCounts[]> {
    return (await this.delegate.findMany({
      where: { matterId, parentId },
      orderBy: { name: "asc" },
      include: { _count: { select: { documents: true, children: true } } },
    })) as DocumentFolderWithCounts[];
  }

  async listByMatter(matterId: MatterId): Promise<DocumentFolder[]> {
    return (await this.delegate.findMany({
      where: { matterId },
      orderBy: { name: "asc" },
    })) as DocumentFolder[];
  }

  async reassignParent(fromParentId: DocumentFolderId, toParentId: DocumentFolderId | null): Promise<void> {
    await this.delegate.updateMany({
      where: { parentId: fromParentId },
      data: { parentId: toParentId } as Partial<DocumentFolder>,
    });
  }
}
