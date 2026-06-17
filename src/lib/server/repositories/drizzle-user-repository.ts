/**
 * Drizzle `UserRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * org-scopar direkt på `users.organizationId`.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import type { User } from "@/lib/shared/schemas/user";
import { users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, type VersionedTable } from "./drizzle-repository";
import type { UserRepository } from "./user-repository";

export class DrizzleUserRepository extends DrizzleRepository<User> implements UserRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, users as unknown as VersionedTable, now);
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<User | null> {
    const rows = await this.db
      .select().from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
      .limit(1);
    return (rows[0] as unknown as User | undefined) ?? null;
  }

  async listByOrg(organizationId: string): Promise<User[]> {
    const rows = await this.db
      .select().from(users)
      .where(and(eq(users.organizationId, organizationId), isNull(users.deletedAt)))
      .orderBy(asc(users.name));
    return rows as unknown as User[];
  }
}
