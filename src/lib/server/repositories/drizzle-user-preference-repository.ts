/** Drizzle `UserPreferenceRepository` (ADR 0020). */

import { and, eq, isNull } from "drizzle-orm";
import type { UserPreference } from "@/lib/shared/schemas/preference";
import { userPreferences } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { UserPreferenceRepository, UserPreferenceRow } from "./user-preference-repository";

export class DrizzleUserPreferenceRepository extends DrizzleRepository<UserPreferenceRow> implements UserPreferenceRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, userPreferences as unknown as VersionedTable, now);
  }

  async getByUserKey(userId: string, organizationId: string, key: string): Promise<UserPreference | null> {
    const rows = await this.db
      .select().from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.organizationId, organizationId), eq(userPreferences.key, key), isNull(userPreferences.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as UserPreference | undefined) ?? null;
  }
}
