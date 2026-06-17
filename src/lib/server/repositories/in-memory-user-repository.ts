/**
 * In-memory `UserRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD;
 * org-scopar direkt på `organizationId`.
 */

import type { User } from "@/lib/shared/schemas/user";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { UserRepository } from "./user-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type UserRepoSource = Pick<IDataStore, "users">;

export class InMemoryUserRepository extends InMemoryRepository<User> implements UserRepository {
  constructor(store: UserRepoSource, now?: () => Date) {
    super(store.users as unknown as Delegate, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<User | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as User | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listByOrg(organizationId: string): Promise<User[]> {
    return (await this.delegate.findMany({ where: { organizationId }, orderBy: { name: "asc" } })) as User[];
  }
}
