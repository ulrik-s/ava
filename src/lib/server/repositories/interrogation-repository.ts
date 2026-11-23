/**
 * `InterrogationRepository` (ADR 0020) — förhör i förordnandemål (#1855).
 * Org-scopas direkt via radens `organizationId`. Bas-CRUD ärvs.
 */

import type { InterrogationId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Interrogation } from "@/lib/shared/schemas/interrogation";
import type { Repository } from "./types";

export interface InterrogationRepository extends Repository<Interrogation> {
  /** Ärendets förhör i byrån, äldst först (efter början). Mjukraderade utelämnas. */
  listForMatter(organizationId: OrganizationId, matterId: MatterId): Promise<Interrogation[]>;
  /** Förhöret by id, org-scopat (null om det saknas, hör till en annan byrå eller är raderat). */
  getByIdInOrg(id: InterrogationId, organizationId: OrganizationId): Promise<Interrogation | null>;
}
