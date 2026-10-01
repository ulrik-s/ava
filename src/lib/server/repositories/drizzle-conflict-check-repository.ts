/**
 * Drizzle `ConflictCheckRepository` (ADR 0020) — server-impl. Joinar utföraren
 * (users) för namn och byrå: tabellen saknar org-kolumn, så byrån är den som
 * körde kontrollens (#1344). Historiken, change_log och synk-pushens
 * byråavgränsning använder den.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { ConflictCheck } from "@/lib/shared/schemas/misc";
import { conflictChecks, users } from "../db/schema";
import type { AppDb } from "../db/types";
import type { ConflictCheckRepository, ConflictCheckRow } from "./conflict-check-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { userOrg } from "./matter-org";

export class DrizzleConflictCheckRepository
  extends DrizzleRepository<ConflictCheck>
  implements ConflictCheckRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(conflictChecks), now);
  }

  /** Byrån via den som körde kontrollen (#1344). */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return userOrg(this.db, (row as { checkedById?: UserId }).checkedById);
  }

  async listHistory(organizationId: OrganizationId, page: number, pageSize: number): Promise<{ checks: ConflictCheckRow[]; total: number }> {
    const inOrg = and(eq(conflictChecks.checkedById, users.id), eq(users.organizationId, organizationId));
    const rows = await this.db
      .select({ chk: conflictChecks, cbName: users.name }).from(conflictChecks)
      .innerJoin(users, inOrg)
      .orderBy(desc(conflictChecks.createdAt))
      .limit(pageSize).offset((page - 1) * pageSize);
    const [agg] = await this.db.select({ total: sql<number>`count(*)` }).from(conflictChecks).innerJoin(users, inOrg);
    return {
      checks: rows.map((r): ConflictCheckRow => ({
        ...r.chk,
        checkedBy: { name: r.cbName },
      })),
      total: Number(agg?.total ?? 0),
    };
  }
}
