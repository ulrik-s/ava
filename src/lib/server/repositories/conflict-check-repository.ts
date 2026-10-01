/**
 * `ConflictCheckRepository` (ADR 0020, #409 fan-out) — jävskontroll-loggen.
 * Bas-CRUD ärvs (`create` loggar en sökning). Tabellen saknar organizationId:
 * byrån är den som körde kontrollens (`checkedById`, #1344) — historiken och
 * synken avgränsas med den.
 */

import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { ConflictCheck } from "@/lib/shared/schemas/misc";
import type { Repository } from "./types";

/** Logg-rad + vem som körde kontrollen. */
export interface ConflictCheckRow extends ConflictCheck {
  checkedBy: { name: string } | null;
}

export interface ConflictCheckRepository extends Repository<ConflictCheck> {
  /** Byråns historik (createdAt desc), paginerad, med utförarens namn + totalantal. */
  listHistory(organizationId: OrganizationId, page: number, pageSize: number): Promise<{ checks: ConflictCheckRow[]; total: number }>;
}
