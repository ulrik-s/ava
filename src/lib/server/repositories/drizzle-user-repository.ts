/**
 * Drizzle `UserRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar direkt på `users.organizationId`.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { User } from "@/lib/shared/schemas/user";
import { users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type { UserRepository } from "./user-repository";

export class DrizzleUserRepository extends DrizzleRepository<User> implements UserRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(users), now);
  }

  async getByIdInOrg(id: UserId, organizationId: OrganizationId): Promise<User | null> {
    const rows = await this.db
      .select().from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]);
  }

  async listByOrg(organizationId: OrganizationId): Promise<User[]> {
    const rows = await this.db
      .select().from(users)
      .where(and(eq(users.organizationId, organizationId), isNull(users.deletedAt)))
      .orderBy(asc(users.name));
    return this.asRows(rows);
  }
}
