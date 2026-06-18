/**
 * Drizzle `DocumentTemplateRepository` (ADR 0020) — server-impl. Left-joinar
 * skaparen (users) för namn.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
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

  async listForOrg(organizationId: string): Promise<DocumentTemplateListRow[]> {
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
    return rows.map((r) => ({
      id: r.id as string, name: r.name as string,
      description: (r.description as string | null) ?? null, category: (r.category as string | null) ?? null,
      createdAt: r.createdAt as Date, updatedAt: (r.updatedAt as Date | null) ?? null,
      createdBy: r.cbName ? { name: r.cbName as string } : null,
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<DocumentTemplateRow | null> {
    const rows = await this.db
      .select({ tpl: documentTemplates, cbName: users.name }).from(documentTemplates)
      .leftJoin(users, eq(documentTemplates.createdById, users.id))
      .where(and(eq(documentTemplates.id, id), eq(documentTemplates.organizationId, organizationId), isNull(documentTemplates.deletedAt)))
      .limit(1);
    if (!rows[0]) return null;
    return { ...(rows[0].tpl as object), createdBy: rows[0].cbName ? { name: rows[0].cbName as string } : null } as unknown as DocumentTemplateRow;
  }
}
