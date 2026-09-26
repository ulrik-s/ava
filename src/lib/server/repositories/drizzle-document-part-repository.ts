/**
 * Drizzle `DocumentPartRepository` (#1220) — server-impl. Org härleds via
 * ärendet (`resolveOrg` → `matterOrg`) så delarna delta-synkas (#528).
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { DocumentPart } from "@/lib/shared/schemas/document";
import type { DocumentId, MatterId } from "@/lib/shared/schemas/ids";
import { documentParts } from "../db/schema";
import type { AppDb } from "../db/types";
import type { DocumentPartRepository } from "./document-part-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { matterOrg } from "./matter-org";

export class DrizzleDocumentPartRepository
  extends DrizzleRepository<DocumentPart>
  implements DocumentPartRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(documentParts), now);
  }

  /** Delar saknar org-kolumn → härled via ärendet så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: MatterId }).matterId);
  }

  async listForDocument(documentId: DocumentId): Promise<DocumentPart[]> {
    const rows = await this.db.select().from(documentParts)
      .where(and(eq(documentParts.documentId, documentId), isNull(documentParts.deletedAt)))
      .orderBy(asc(documentParts.fromPage));
    return this.asRows(rows);
  }

  async listByMatter(matterId: MatterId): Promise<DocumentPart[]> {
    const rows = await this.db.select().from(documentParts)
      .where(and(eq(documentParts.matterId, matterId), isNull(documentParts.deletedAt)))
      .orderBy(asc(documentParts.documentId), asc(documentParts.fromPage));
    return this.asRows(rows);
  }
}
