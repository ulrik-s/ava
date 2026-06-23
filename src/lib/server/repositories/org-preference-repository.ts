/**
 * `OrgPreferenceRepository` (ADR 0020, #409 fan-out) — org-defaults per UI-key
 * (ADMIN). Bas-CRUD ärvs; `getByOrgKey` upsert-uppslag, `listByOrg` admin-UI:t.
 */

import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { OrgPreference } from "@/lib/shared/schemas/preference";
import type { Repository, RowBase } from "./types";

/** Preference-schemat saknar baseFields (version/deletedAt) → intersekta RowBase. */
export type OrgPreferenceRow = OrgPreference & RowBase;

export interface OrgPreferenceRepository extends Repository<OrgPreferenceRow> {
  /** Org-default för (org, key) — null om ingen/raderad. */
  getByOrgKey(organizationId: OrganizationId, key: string): Promise<OrgPreference | null>;
  /** Alla org-defaults (key asc). */
  listByOrg(organizationId: OrganizationId): Promise<OrgPreference[]>;
}
