/**
 * Drizzle `MatterRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar direkt på `matters.organizationId` (ingen join).
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Matter } from "@/lib/shared/schemas/matter";
import { matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { MatterRepository } from "./matter-repository";

export class DrizzleMatterRepository extends DrizzleRepository<Matter> implements MatterRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, matters as unknown as VersionedTable, now);
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Matter | null> {
    const rows = await this.db
      .select().from(matters)
      .where(and(eq(matters.id, id), eq(matters.organizationId, organizationId), isNull(matters.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as Matter | undefined) ?? null;
  }
}
