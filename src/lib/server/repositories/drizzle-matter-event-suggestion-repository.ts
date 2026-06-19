/**
 * Drizzle `MatterEventSuggestionRepository` (ADR 0020) — server-impl. Org-scopar
 * via join dokument→ärende.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { MatterEventSuggestion } from "@/lib/shared/schemas/document";
import { asId } from "@/lib/shared/schemas/ids";
import { documents, matterEventSuggestions, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  MatterEventSuggestionRepository, MatterEventSuggestionRow,
} from "./matter-event-suggestion-repository";

export class DrizzleMatterEventSuggestionRepository
  extends DrizzleRepository<MatterEventSuggestion>
  implements MatterEventSuggestionRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(matterEventSuggestions), now);
  }

  async listForMatter(matterId: string, organizationId: string): Promise<MatterEventSuggestionRow[]> {
    const rows = await this.db
      .select({
        ev: matterEventSuggestions,
        dId: documents.id, dFile: documents.fileName, dTitle: documents.title,
      })
      .from(matterEventSuggestions)
      .innerJoin(documents, eq(matterEventSuggestions.documentId, documents.id))
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(
        eq(documents.matterId, asId<"MatterId">(matterId)),
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        ne(matterEventSuggestions.status, "REJECTED"),
        isNull(matterEventSuggestions.deletedAt),
      ))
      .orderBy(asc(matterEventSuggestions.startAt));
    return rows.map((r): MatterEventSuggestionRow => ({
      ...r.ev,
      document: { id: r.dId, fileName: r.dFile, title: r.dTitle ?? null },
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<MatterEventSuggestion | null> {
    const rows = await this.db
      .select({ ev: matterEventSuggestions }).from(matterEventSuggestions)
      .innerJoin(documents, eq(matterEventSuggestions.documentId, documents.id))
      .innerJoin(matters, eq(documents.matterId, matters.id))
      .where(and(
        eq(matterEventSuggestions.id, asId<"MatterEventSuggestionId">(id)),
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        isNull(matterEventSuggestions.deletedAt),
      ))
      .limit(1);
    return rows[0]?.ev ?? null;
  }
}
