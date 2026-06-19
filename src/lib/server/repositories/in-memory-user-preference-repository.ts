/** In-memory `UserPreferenceRepository` (ADR 0020). */

import type { UserPreference } from "@/lib/shared/schemas/preference";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { UserPreferenceRepository, UserPreferenceRow } from "./user-preference-repository";

export type UserPreferenceRepoSource = Pick<IDataStore, "userPreferences">;

export class InMemoryUserPreferenceRepository extends InMemoryRepository<UserPreferenceRow> implements UserPreferenceRepository {
  constructor(store: UserPreferenceRepoSource, now?: () => Date) {
    super(store.userPreferences, now ?? (() => new Date()));
  }

  async getByUserKey(userId: string, organizationId: string, key: string): Promise<UserPreference | null> {
    const row = (await this.delegate.findFirst({ where: { userId, organizationId, key } })) as UserPreference | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
