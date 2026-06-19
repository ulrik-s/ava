/**
 * Drizzle `OfficeRepository` (ADR 0020) — server-impl.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Office } from "@/lib/shared/schemas/organization";
import { offices } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { OfficeRepository } from "./office-repository";

export class DrizzleOfficeRepository extends DrizzleRepository<Office> implements OfficeRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(offices), now);
  }

  async listByOrg(organizationId: string): Promise<Office[]> {
    const rows = await this.db
      .select().from(offices)
      .where(and(eq(offices.organizationId, organizationId), isNull(offices.deletedAt)))
      .orderBy(desc(offices.isMain), asc(offices.name));
    return this.asRows(rows);
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Office | null> {
    const rows = await this.db
      .select().from(offices)
      .where(and(eq(offices.id, id), eq(offices.organizationId, organizationId), isNull(offices.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]);
  }

  async demoteMains(organizationId: string): Promise<void> {
    await this.db.update(offices).set({ isMain: false } as never)
      .where(and(eq(offices.organizationId, organizationId), eq(offices.isMain, true)));
  }
}
