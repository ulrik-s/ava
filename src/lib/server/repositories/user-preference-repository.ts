/**
 * `UserPreferenceRepository` (ADR 0020, #409 fan-out) — per-användar-preferenser
 * (kolumn/sort/vy per UI-key). Bas-CRUD ärvs; `getByUserKey` är upsert-uppslaget.
 */

import type { UserPreference } from "@/lib/shared/schemas/preference";
import type { Repository, RowBase } from "./types";

/** Preference-schemat saknar baseFields (version/deletedAt) → intersekta RowBase. */
export type UserPreferenceRow = UserPreference & RowBase;

export interface UserPreferenceRepository extends Repository<UserPreferenceRow> {
  /** User-pref för (userId, org, key) — null om ingen/raderad. */
  getByUserKey(userId: string, organizationId: string, key: string): Promise<UserPreference | null>;
}
