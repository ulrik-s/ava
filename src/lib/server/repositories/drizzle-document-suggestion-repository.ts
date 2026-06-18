/**
 * Drizzle `DocumentSuggestionRepository` (ADR 0020) — server-impl. Org-scopar
 * via join förslag→dokument→ärende.
 */

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DocumentAnalysisSuggestion } from "@/lib/shared/schemas/document";
import { documentAnalysisSuggestions, documents, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import type {
  DocumentSuggestionRepository, SuggestionListRow, SuggestionWithMatter,
} from "./document-suggestion-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

const S = documentAnalysisSuggestions;

export class DrizzleDocumentSuggestionRepository
  extends DrizzleRepository<DocumentAnalysisSuggestion>
  implements DocumentSuggestionRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(S), now);
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<SuggestionWithMatter | null> {
    const rows = await this.db
      .select({ s: S, matterId: documents.matterId }).from(S)
      .innerJoin(documents, eq(S.documentId, documents.id))
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(eq(S.id, id), eq(matters.organizationId, organizationId), isNull(S.deletedAt)))
      .limit(1);
    const r = rows[0];
    return r ? ({ ...(r.s as object), document: { matterId: r.matterId as string } } as unknown as SuggestionWithMatter) : null;
  }

  async listPendingForMatter(matterId: string, organizationId: string, order: "asc" | "desc"): Promise<SuggestionListRow[]> {
    const rows = await this.db
      .select({ s: S, dId: documents.id, dFile: documents.fileName, dTitle: documents.title }).from(S)
      .innerJoin(documents, eq(S.documentId, documents.id))
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(
        eq(S.status, "PENDING"), eq(documents.matterId, matterId),
        eq(matters.organizationId, organizationId), isNull(S.deletedAt),
      ))
      .orderBy(order === "asc" ? asc(S.createdAt) : desc(S.createdAt));
    return rows.map((r) => ({
      ...(r.s as object),
      document: { id: r.dId as string, fileName: r.dFile as string, title: (r.dTitle as string | null) ?? null },
    })) as unknown as SuggestionListRow[];
  }

  async listPendingByIds(ids: string[], organizationId: string): Promise<SuggestionWithMatter[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ s: S, matterId: documents.matterId }).from(S)
      .innerJoin(documents, eq(S.documentId, documents.id))
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(inArray(S.id, ids), eq(S.status, "PENDING"), eq(matters.organizationId, organizationId), isNull(S.deletedAt)));
    return rows.map((r) => ({ ...(r.s as object), document: { matterId: r.matterId as string } })) as unknown as SuggestionWithMatter[];
  }

  async listByIdsInOrg(ids: string[], organizationId: string): Promise<Array<{ id: string }>> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: S.id }).from(S)
      .innerJoin(documents, eq(S.documentId, documents.id))
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(inArray(S.id, ids), eq(matters.organizationId, organizationId), isNull(S.deletedAt)));
    return rows.map((r) => ({ id: r.id as string }));
  }

  async updateManyByIds(ids: string[], patch: Partial<DocumentAnalysisSuggestion>): Promise<void> {
    if (!ids.length) return;
    await this.db.update(S).set(patch as never).where(inArray(S.id, ids));
  }
}
