/**
 * `MatterRepository` (ADR 0020, #409 fan-out) — ärenden. Nästan varje
 * faktura-mutation börjar med en org-scopad ärende-uppslagning, så detta är
 * fundamentet som de transaktions-mutationerna stegvis migrerar ovanpå.
 * Bas-CRUD ärvs; `getByIdInOrg` är den enda entitets-specifika läsningen
 * (ärenden bär `organizationId` direkt → enkel where, ingen join).
 */

import type { Matter } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

export interface MatterRepository extends Repository<Matter> {
  /** Ärende by id, org-scopat (null om saknas/annan org/raderat). */
  getByIdInOrg(id: string, organizationId: string): Promise<Matter | null>;
  /** Alla (icke-raderade) ärenden i org:en. */
  listByOrg(organizationId: string): Promise<Matter[]>;
}
