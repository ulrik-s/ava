/**
 * In-memory `UserRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD;
 * org-scopar direkt på `organizationId`.
 */

import type { OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { User } from "@/lib/shared/schemas/user";
import { sameLoginEmail } from "../auth/login-email-normalize";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { UserRepository } from "./user-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type UserRepoSource = Pick<IDataStore, "users">;

export class InMemoryUserRepository extends InMemoryRepository<User> implements UserRepository {
  constructor(store: UserRepoSource, now?: () => Date) {
    super(store.users, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: UserId, organizationId: OrganizationId): Promise<User | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as User | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listByOrg(organizationId: OrganizationId): Promise<User[]> {
    return (await this.delegate.findMany({ where: { organizationId }, orderBy: { name: "asc" } })) as User[];
  }

  async listByLoginEmail(email: string): Promise<User[]> {
    const all = (await this.delegate.findMany({})) as User[];
    return all.filter((u) => !(u as { deletedAt?: unknown }).deletedAt && sameLoginEmail(u.email, email));
  }
}
