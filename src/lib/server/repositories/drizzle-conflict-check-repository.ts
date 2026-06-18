/**
 * Drizzle `ConflictCheckRepository` (ADR 0020) — server-impl. Left-joinar
 * utföraren (users) för namn. Historiken är global (ingen org-kolumn).
 */

import { desc, eq, sql } from "drizzle-orm";
import type { ConflictCheck } from "@/lib/shared/schemas/misc";
import { conflictChecks, users } from "../db/schema";
import type { AppDb } from "../db/types";
import type { ConflictCheckRepository, ConflictCheckRow } from "./conflict-check-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

export class DrizzleConflictCheckRepository
  extends DrizzleRepository<ConflictCheck>
  implements ConflictCheckRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(conflictChecks), now);
  }

  async listHistory(page: number, pageSize: number): Promise<{ checks: ConflictCheckRow[]; total: number }> {
    const rows = await this.db
      .select({ chk: conflictChecks, cbName: users.name }).from(conflictChecks)
      .leftJoin(users, eq(conflictChecks.checkedById, users.id))
      .orderBy(desc(conflictChecks.createdAt))
      .limit(pageSize).offset((page - 1) * pageSize);
    const [agg] = await this.db.select({ total: sql<number>`count(*)` }).from(conflictChecks);
    return {
      checks: rows.map((r) => ({
        ...(r.chk as object),
        checkedBy: r.cbName ? { name: r.cbName as string } : null,
      })) as unknown as ConflictCheckRow[],
      total: Number(agg?.total ?? 0),
    };
  }
}
