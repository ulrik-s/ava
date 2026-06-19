/** In-memory `OrgPreferenceRepository` (ADR 0020). */

import type { OrgPreference } from "@/lib/shared/schemas/preference";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { OrgPreferenceRepository, OrgPreferenceRow } from "./org-preference-repository";

export type OrgPreferenceRepoSource = Pick<IDataStore, "orgPreferences">;

export class InMemoryOrgPreferenceRepository extends InMemoryRepository<OrgPreferenceRow> implements OrgPreferenceRepository {
  constructor(store: OrgPreferenceRepoSource, now?: () => Date) {
    super(store.orgPreferences, now ?? (() => new Date()));
  }

  async getByOrgKey(organizationId: string, key: string): Promise<OrgPreference | null> {
    const row = (await this.delegate.findFirst({ where: { organizationId, key } })) as OrgPreference | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listByOrg(organizationId: string): Promise<OrgPreference[]> {
    return (await this.delegate.findMany({ where: { organizationId }, orderBy: { key: "asc" } })) as OrgPreference[];
  }
}
