/**
 * Drizzle `DocumentTemplateRepository` (ADR 0020) — server-impl. Left-joinar
 * skaparen (users) för namn.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { DocumentTemplateId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { DocumentTemplate } from "@/lib/shared/schemas/misc";
import { documentTemplates, users } from "../db/schema";
import type { AppDb } from "../db/types";
import type {
  DocumentTemplateListRow, DocumentTemplateRepository, DocumentTemplateRow,
} from "./document-template-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

export class DrizzleDocumentTemplateRepository
  extends DrizzleRepository<DocumentTemplate>
  implements DocumentTemplateRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(documentTemplates), now);
  }

  async listForOrg(organizationId: OrganizationId): Promise<DocumentTemplateListRow[]> {
    const rows = await this.db
      .select({
        id: documentTemplates.id, name: documentTemplates.name,
        description: documentTemplates.description, category: documentTemplates.category,
        createdAt: documentTemplates.createdAt, updatedAt: documentTemplates.updatedAt,
        cbName: users.name,
      })
      .from(documentTemplates)
      .leftJoin(users, eq(documentTemplates.createdById, users.id))
      .where(and(eq(documentTemplates.organizationId, organizationId), isNull(documentTemplates.deletedAt)))
      .orderBy(asc(documentTemplates.category), asc(documentTemplates.name));
    return rows.map((r): DocumentTemplateListRow => ({
      id: r.id, name: r.name,
      description: r.description ?? null, category: r.category ?? null,
      createdAt: r.createdAt, updatedAt: r.updatedAt ?? null,
      createdBy: r.cbName ? { name: r.cbName } : null,
    }));
  }

  async getByIdInOrg(id: DocumentTemplateId, organizationId: OrganizationId): Promise<DocumentTemplateRow | null> {
    const rows = await this.db
      .select({ tpl: documentTemplates, cbName: users.name }).from(documentTemplates)
      .leftJoin(users, eq(documentTemplates.createdById, users.id))
      .where(and(eq(documentTemplates.id, id), eq(documentTemplates.organizationId, organizationId), isNull(documentTemplates.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { ...row.tpl, createdBy: row.cbName ? { name: row.cbName } : null };
  }
}
