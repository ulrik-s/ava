/**
 * In-memory `DocumentSuggestionRepository` (ADR 0020) — browser/offline-impl.
 * document→matter-relations registrerade i relations.ts.
 */

import type { DocumentAnalysisSuggestion } from "@/lib/shared/schemas/document";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import type {
  DocumentSuggestionRepository, SuggestionListRow, SuggestionWithMatter,
} from "./document-suggestion-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentSuggestionRepoSource = Pick<IDataStore, "documentAnalysisSuggestions">;

export class InMemoryDocumentSuggestionRepository
  extends InMemoryRepository<DocumentAnalysisSuggestion>
  implements DocumentSuggestionRepository {
  constructor(store: DocumentSuggestionRepoSource, now?: () => Date) {
    super(store.documentAnalysisSuggestions as unknown as Delegate, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<SuggestionWithMatter | null> {
    return (await this.delegate.findFirst({
      where: { id, document: { matter: { organizationId } } },
      include: { document: { select: { matterId: true } } },
    })) as SuggestionWithMatter | null;
  }

  async listPendingForMatter(matterId: string, organizationId: string, order: "asc" | "desc"): Promise<SuggestionListRow[]> {
    return (await this.delegate.findMany({
      where: { status: "PENDING", document: { matterId, matter: { organizationId } } },
      include: { document: { select: { id: true, fileName: true, title: true } } },
      orderBy: { createdAt: order },
    })) as SuggestionListRow[];
  }

  async listPendingByIds(ids: string[], organizationId: string): Promise<SuggestionWithMatter[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, status: "PENDING", document: { matter: { organizationId } } },
      include: { document: { select: { matterId: true } } },
    })) as SuggestionWithMatter[];
  }

  async listByIdsInOrg(ids: string[], organizationId: string): Promise<Array<{ id: string }>> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, document: { matter: { organizationId } } },
      select: { id: true },
    })) as Array<{ id: string }>;
  }

  async updateManyByIds(ids: string[], patch: Partial<DocumentAnalysisSuggestion>): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({ where: { id: { in: ids } }, data: patch });
  }
}
