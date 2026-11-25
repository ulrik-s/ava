/**
 * In-memory `MatterRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD
 * och org-scopar direkt på `organizationId` (ärenden saknar relations-beroende).
 */

import type { MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import {
  listPartiesOf, partiesByMatter,
  type MatterDetailRow, type MatterListFilter, type MatterListLink, type MatterListParty, type MatterListResult,
  type MatterListRow, type MatterRepository,
} from "./matter-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type MatterRepoSource = Pick<IDataStore, "matters">;

/** Listraden ur delegatens rad med alla (icke-raderade) kopplingar i `contacts`. */
type MatterLinksRow = Matter & { contacts: MatterListLink[]; _count: MatterListRow["_count"] };

/** Ärendets icke-raderade kopplingar med kontaktens id och namn, i `createdAt`-ordning (lista och parter, #1964). */
const LINKS_INCLUDE = {
  where: { deletedAt: null },
  include: { contact: { select: { id: true, name: true } } },
  orderBy: { createdAt: "asc" },
} as const;

/** Org-scopat where för listan (replikerar routerns Prisma-where). */
function listWhere(organizationId: OrganizationId, f: MatterListFilter): Record<string, unknown> {
  const ins = (s: string) => ({ contains: s, mode: "insensitive" as const });
  return {
    organizationId,
    deletedAt: null, // mjukt raderade syns inte, som i Postgres (#1678)
    ...(f.status ? { status: f.status } : {}),
    ...(f.employeeId ? { timeEntries: { some: { userId: f.employeeId } } } : {}),
    ...(f.ids ? { id: { in: [...f.ids] } } : {}),
    ...(f.search
      ? {
          OR: [
            { title: ins(f.search) },
            { matterNumber: ins(f.search) },
            { courtCaseNumber: ins(f.search) },
            { previousCourtCaseNumber: ins(f.search) },
            { insuranceReference: ins(f.search) },
            { contacts: { some: { contact: { name: ins(f.search) } } } },
          ],
        }
      : {}),
  };
}

export class InMemoryMatterRepository extends InMemoryRepository<Matter> implements MatterRepository {
  constructor(store: MatterRepoSource, now?: () => Date) {
    super(store.matters, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: MatterId, organizationId: OrganizationId): Promise<Matter | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as Matter | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listByOrg(organizationId: OrganizationId): Promise<Matter[]> {
    const rows = (await this.delegate.findMany({ where: { organizationId } })) as Matter[];
    return rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);
  }

  async listForOrg(organizationId: OrganizationId, filter: MatterListFilter): Promise<MatterListResult> {
    const where = listWhere(organizationId, filter);
    const [rows, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: {
          contacts: LINKS_INCLUDE,
          _count: { select: { documents: true, timeEntries: true, contacts: true } },
        },
      }) as Promise<MatterLinksRow[]>,
      this.delegate.count({ where }),
    ]);
    const matters = rows.map((r): MatterListRow => ({ ...r, ...listPartiesOf(r.contacts) }));
    return { matters, total };
  }

  async listPartiesFor(organizationId: OrganizationId, matterIds: readonly MatterId[]): Promise<Map<MatterId, MatterListParty[]>> {
    if (matterIds.length === 0) return new Map();
    const rows = (await this.delegate.findMany({
      where: { organizationId, id: { in: [...matterIds] }, deletedAt: null },
      include: { contacts: LINKS_INCLUDE },
    })) as Array<Matter & { contacts: MatterListLink[] }>;
    return partiesByMatter(new Map(rows.filter((r) => r.contacts.length > 0).map((r) => [r.id, r.contacts])));
  }

  async getByIdWithContacts(id: MatterId, organizationId: OrganizationId): Promise<MatterDetailRow | null> {
    const row = (await this.delegate.findFirst({
      where: { id, organizationId },
      include: {
        contacts: { include: { contact: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { documents: true, timeEntries: true, emails: true } },
      },
    })) as (MatterDetailRow & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }

  async listByResponsibleLawyer(organizationId: OrganizationId, responsibleLawyerId: UserId): Promise<Matter[]> {
    return (await this.delegate.findMany({ where: { organizationId, responsibleLawyerId, deletedAt: null } })) as Matter[];
  }

  async listByNumberPrefix(organizationId: OrganizationId, prefix: string): Promise<Matter[]> {
    return (await this.delegate.findMany({
      where: { organizationId, matterNumber: { startsWith: prefix }, deletedAt: null },
    })) as Matter[];
  }
}
