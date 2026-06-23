/**
 * In-memory `DocumentSuggestionRepository` (ADR 0020) — browser/offline-impl.
 * document→matter-relations registrerade i relations.ts.
 */

import type { DocumentAnalysisSuggestion } from "@/lib/shared/schemas/document";
import type {
  DocumentAnalysisSuggestionId, MatterId, OrganizationId,
} from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  DocumentSuggestionRepository, SuggestionListRow, SuggestionWithMatter,
} from "./document-suggestion-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentSuggestionRepoSource = Pick<IDataStore, "documentAnalysisSuggestions">;

export class InMemoryDocumentSuggestionRepository
  extends InMemoryRepository<DocumentAnalysisSuggestion>
  implements DocumentSuggestionRepository {
  constructor(store: DocumentSuggestionRepoSource, now?: () => Date) {
    super(store.documentAnalysisSuggestions, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: DocumentAnalysisSuggestionId, organizationId: OrganizationId): Promise<SuggestionWithMatter | null> {
    return (await this.delegate.findFirst({
      where: { id, document: { matter: { organizationId } } },
      include: { document: { select: { matterId: true } } },
    })) as SuggestionWithMatter | null;
  }

  async listPendingForMatter(matterId: MatterId, organizationId: OrganizationId, order: "asc" | "desc"): Promise<SuggestionListRow[]> {
    return (await this.delegate.findMany({
      where: { status: "PENDING", document: { matterId, matter: { organizationId } } },
      include: { document: { select: { id: true, fileName: true, title: true } } },
      orderBy: { createdAt: order },
    })) as SuggestionListRow[];
  }

  async listPendingByIds(ids: DocumentAnalysisSuggestionId[], organizationId: OrganizationId): Promise<SuggestionWithMatter[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, status: "PENDING", document: { matter: { organizationId } } },
      include: { document: { select: { matterId: true } } },
    })) as SuggestionWithMatter[];
  }

  async listByIdsInOrg(ids: DocumentAnalysisSuggestionId[], organizationId: OrganizationId): Promise<Array<{ id: DocumentAnalysisSuggestionId }>> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, document: { matter: { organizationId } } },
      select: { id: true },
    })) as Array<{ id: DocumentAnalysisSuggestionId }>;
  }

  async updateManyByIds(ids: DocumentAnalysisSuggestionId[], patch: Partial<DocumentAnalysisSuggestion>): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({ where: { id: { in: ids } }, data: patch });
  }
}
