/**
 * Drizzle `ExpectedReceivableRepository` (ADR 0020) — server-impl.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import type { ExpectedReceivable } from "@/lib/shared/schemas/billing";
import { expectedReceivables } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { ExpectedReceivableListFilter, ExpectedReceivableRepository } from "./expected-receivable-repository";

export class DrizzleExpectedReceivableRepository
  extends DrizzleRepository<ExpectedReceivable>
  implements ExpectedReceivableRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(expectedReceivables), now);
  }

  async listForOrg(organizationId: string, filter?: ExpectedReceivableListFilter): Promise<ExpectedReceivable[]> {
    const rows = await this.db
      .select().from(expectedReceivables)
      .where(and(
        eq(expectedReceivables.organizationId, organizationId),
        isNull(expectedReceivables.deletedAt),
        filter?.matterId ? eq(expectedReceivables.matterId, filter.matterId) : undefined,
        filter?.status ? eq(expectedReceivables.status, filter.status) : undefined,
      ))
      .orderBy(desc(expectedReceivables.createdAt));
    return this.asRows(rows);
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<ExpectedReceivable | null> {
    const rows = await this.db
      .select().from(expectedReceivables)
      .where(and(eq(expectedReceivables.id, id), eq(expectedReceivables.organizationId, organizationId), isNull(expectedReceivables.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]);
  }
}
