/**
 * `OfficeRepository` (ADR 0020, #409 fan-out) — kontor. Org-scopas direkt.
 * Bas-CRUD ärvs; `demoteMains` nollar huvudkontors-flaggan (en main åt gången).
 */

import type { OfficeId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Office } from "@/lib/shared/schemas/organization";
import type { Repository } from "./types";

export interface OfficeRepository extends Repository<Office> {
  /** Org:ens kontor (huvudkontor först, sedan namn). */
  listByOrg(organizationId: OrganizationId): Promise<Office[]>;
  /** Kontor by id, org-scopat (null om saknas/annan org/raderat). */
  getByIdInOrg(id: OfficeId, organizationId: OrganizationId): Promise<Office | null>;
  /** Nolla `isMain` på alla nuvarande huvudkontor i org:en (innan ett nytt sätts). */
  demoteMains(organizationId: OrganizationId): Promise<void>;
}
