/**
 * In-memory `DocumentTemplateRepository` (ADR 0020) — browser/offline-impl.
 */

import type { DocumentTemplate } from "@/lib/shared/schemas/misc";
import type { IDataStore } from "../data-store/IDataStore";
import type {
  DocumentTemplateListRow, DocumentTemplateRepository, DocumentTemplateRow,
} from "./document-template-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type DocumentTemplateRepoSource = Pick<IDataStore, "documentTemplates">;

export class InMemoryDocumentTemplateRepository
  extends InMemoryRepository<DocumentTemplate>
  implements DocumentTemplateRepository {
  constructor(private readonly source: DocumentTemplateRepoSource, now?: () => Date) {
    super(source.documentTemplates, now ?? (() => new Date()));
  }

  async listForOrg(organizationId: string): Promise<DocumentTemplateListRow[]> {
    const rows = await this.source.documentTemplates.findMany({
      where: { organizationId },
      select: {
        id: true, name: true, description: true, category: true,
        createdAt: true, updatedAt: true, createdBy: { select: { name: true } },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return rows.map((r): DocumentTemplateListRow => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      category: r.category ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? null,
      createdBy: (r.createdBy ?? null) as { name: string } | null,
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<DocumentTemplateRow | null> {
    const row = (await this.delegate.findFirst({
      where: { id, organizationId },
      include: { createdBy: { select: { name: true } } },
    })) as DocumentTemplateRow | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
