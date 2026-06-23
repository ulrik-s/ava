/**
 * `ExpectedReceivableRepository` (ADR 0020, #409 fan-out) — förväntade
 * domstolsbetalningar (#173). Org-scopas direkt. Bas-CRUD ärvs.
 */

import type { ExpectedReceivable, ExpectedReceivableStatus } from "@/lib/shared/schemas/billing";
import type { ExpectedReceivableId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repository } from "./types";

export interface ExpectedReceivableListFilter {
  matterId?: MatterId | undefined;
  status?: ExpectedReceivableStatus | undefined;
}

export interface ExpectedReceivableRepository extends Repository<ExpectedReceivable> {
  /** Org:ens fordringar (nyaste först), valfritt filtrerade på ärende/status. */
  listForOrg(organizationId: OrganizationId, filter?: ExpectedReceivableListFilter): Promise<ExpectedReceivable[]>;
  /** Fordran by id, org-scopad (null om saknas/annan org/raderad). */
  getByIdInOrg(id: ExpectedReceivableId, organizationId: OrganizationId): Promise<ExpectedReceivable | null>;
}
