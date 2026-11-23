/**
 * Drizzle `InterrogationRepository` (ADR 0020) — server-impl (#1855).
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { InterrogationId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Interrogation } from "@/lib/shared/schemas/interrogation";
import { interrogations } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { InterrogationRepository } from "./interrogation-repository";

export class DrizzleInterrogationRepository
  extends DrizzleRepository<Interrogation>
  implements InterrogationRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(interrogations), now);
  }

  async listForMatter(organizationId: OrganizationId, matterId: MatterId): Promise<Interrogation[]> {
    const rows = await this.db
      .select().from(interrogations)
      .where(and(
        eq(interrogations.organizationId, organizationId),
        eq(interrogations.matterId, matterId),
        isNull(interrogations.deletedAt),
      ))
      .orderBy(asc(interrogations.start));
    return this.asRows(rows);
  }

  async getByIdInOrg(id: InterrogationId, organizationId: OrganizationId): Promise<Interrogation | null> {
    const rows = await this.db
      .select().from(interrogations)
      .where(and(eq(interrogations.id, id), eq(interrogations.organizationId, organizationId), isNull(interrogations.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]);
  }
}
