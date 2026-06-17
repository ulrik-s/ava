/**
 * `ConflictCheckRepository` (ADR 0020, #409 fan-out) — jävskontroll-loggen.
 * Bas-CRUD ärvs (`create` loggar en sökning). `listHistory` är medvetet INTE
 * org-scopad — tabellen saknar organizationId (speglar dagens beteende).
 */

import type { ConflictCheck } from "@/lib/shared/schemas/misc";
import type { Repository } from "./types";

/** Logg-rad + vem som körde kontrollen. */
export interface ConflictCheckRow extends ConflictCheck {
  checkedBy: { name: string } | null;
}

export interface ConflictCheckRepository extends Repository<ConflictCheck> {
  /** Paginerad historik (createdAt desc) med utförarens namn + totalantal. */
  listHistory(page: number, pageSize: number): Promise<{ checks: ConflictCheckRow[]; total: number }>;
}
