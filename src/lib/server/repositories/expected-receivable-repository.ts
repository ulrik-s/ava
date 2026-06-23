/**
 * `ExpectedReceivableRepository` (ADR 0020, #409 fan-out) — förväntade
 * domstolsbetalningar (#173). Org-scopas direkt. Bas-CRUD ärvs.
 */

import type { ExpectedReceivable, ExpectedReceivableStatus } from "@/lib/shared/schemas/billing";
import type { Repository } from "./types";

export interface ExpectedReceivableListFilter {
  matterId?: string | undefined;
  status?: ExpectedReceivableStatus | undefined;
}

export interface ExpectedReceivableRepository extends Repository<ExpectedReceivable> {
  /** Org:ens fordringar (nyaste först), valfritt filtrerade på ärende/status. */
  listForOrg(organizationId: string, filter?: ExpectedReceivableListFilter): Promise<ExpectedReceivable[]>;
  /** Fordran by id, org-scopad (null om saknas/annan org/raderad). */
  getByIdInOrg(id: string, organizationId: string): Promise<ExpectedReceivable | null>;
}
