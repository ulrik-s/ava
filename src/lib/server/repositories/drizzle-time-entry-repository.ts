/**
 * Drizzle `TimeEntryRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `listUnbilled` joinar users för timtaxan, `flagBilled` bulk-sätter invoiceId.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import { timeEntries, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { TimeEntryRepository, UnbilledTimeEntry } from "./time-entry-repository";

export class DrizzleTimeEntryRepository extends DrizzleRepository<TimeEntry> implements TimeEntryRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, timeEntries as unknown as VersionedTable, now);
  }

  async listUnbilled(matterId: string, ids: string[]): Promise<UnbilledTimeEntry[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ te: timeEntries, hourlyRate: users.hourlyRate }).from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(inArray(timeEntries.id, ids), eq(timeEntries.matterId, matterId), isNull(timeEntries.invoiceId)));
    return rows.map((r) => ({
      ...(r.te as object), user: { hourlyRate: r.hourlyRate },
    })) as unknown as UnbilledTimeEntry[];
  }

  async flagBilled(ids: string[], invoiceId: string): Promise<void> {
    if (!ids.length) return;
    await this.db.update(timeEntries).set({ invoiceId } as never).where(inArray(timeEntries.id, ids));
  }
}
