/**
 * `MatterRepository` (ADR 0020, #409 fan-out) — ärenden. Nästan varje
 * faktura-mutation börjar med en org-scopad ärende-uppslagning, så detta är
 * fundamentet som de transaktions-mutationerna stegvis migrerar ovanpå.
 * Bas-CRUD ärvs; läsmetoderna org-scopar direkt (ärenden bär `organizationId`).
 */

import type { MatterStatus } from "@/lib/shared/schemas/enums";
import type { ContactId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Matter, MatterContact } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

/** Kontaktvyn detaljens kontaktlista bär (matchar UI-komponenternas props). */
export interface MatterContactContactView {
  id: string;
  name: string;
  contactType?: string;
  personalNumber?: string | null;
  orgNumber?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Listrad: ärende + KLIENT-kontakt + relations-antal (matter.list). */
export interface MatterListRow extends Matter {
  contacts: Array<{ contact: { id: ContactId; name: string } }>;
  _count: { documents: number; timeEntries: number; contacts: number };
}

/** Detaljrad: ärende + alla kontakter (createdAt asc) + relations-antal (matter.getById). */
export interface MatterDetailRow extends Matter {
  contacts: Array<MatterContact & { contact: MatterContactContactView }>;
  _count: { documents: number; timeEntries: number; emails: number };
}

/** Filter/paginering för `listForOrg`. */
export interface MatterListFilter {
  search?: string | undefined;
  status?: MatterStatus | undefined;
  employeeId?: UserId | undefined;
  page: number;
  pageSize: number;
}

export interface MatterListResult {
  matters: MatterListRow[];
  total: number;
}

export interface MatterRepository extends Repository<Matter> {
  /** Ärende by id, org-scopat (null om saknas/annan org/raderat). */
  getByIdInOrg(id: MatterId, organizationId: OrganizationId): Promise<Matter | null>;
  /** Alla (icke-raderade) ärenden i org:en. */
  listByOrg(organizationId: OrganizationId): Promise<Matter[]>;
  /** Org-scopad, paginerad/sökbar lista (createdAt desc) med KLIENT + _count + total. */
  listForOrg(organizationId: OrganizationId, filter: MatterListFilter): Promise<MatterListResult>;
  /** Ärende by id med alla kontakter + _count, org-scopat. Null om saknas. */
  getByIdWithContacts(id: MatterId, organizationId: OrganizationId): Promise<MatterDetailRow | null>;
  /** Ärenden för en ansvarig jurist i org:en (#174 ärendenummer-serie). */
  listByResponsibleLawyer(organizationId: OrganizationId, responsibleLawyerId: UserId): Promise<Matter[]>;
  /** Ärenden i org:en vars nummer börjar med ett prefix (#174 kollisionsfritt). */
  listByNumberPrefix(organizationId: OrganizationId, prefix: string): Promise<Matter[]>;
}
