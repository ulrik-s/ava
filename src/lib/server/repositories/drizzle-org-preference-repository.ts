/** Drizzle `OrgPreferenceRepository` (ADR 0020). */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { OrgPreference } from "@/lib/shared/schemas/preference";
import { orgPreferences } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { OrgPreferenceRepository, OrgPreferenceRow } from "./org-preference-repository";

export class DrizzleOrgPreferenceRepository extends DrizzleRepository<OrgPreferenceRow> implements OrgPreferenceRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, orgPreferences as unknown as VersionedTable, now);
  }

  async getByOrgKey(organizationId: string, key: string): Promise<OrgPreference | null> {
    const rows = await this.db
      .select().from(orgPreferences)
      .where(and(eq(orgPreferences.organizationId, organizationId), eq(orgPreferences.key, key), isNull(orgPreferences.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as OrgPreference | undefined) ?? null;
  }

  async listByOrg(organizationId: string): Promise<OrgPreference[]> {
    const rows = await this.db
      .select().from(orgPreferences)
      .where(and(eq(orgPreferences.organizationId, organizationId), isNull(orgPreferences.deletedAt)))
      .orderBy(asc(orgPreferences.key));
    return rows as unknown as OrgPreference[];
  }
}
