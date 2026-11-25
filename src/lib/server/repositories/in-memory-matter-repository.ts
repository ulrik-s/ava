/**
 * In-memory `MatterRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD
 * och org-scopar direkt på `organizationId` (ärenden saknar relations-beroende).
 */

import type { MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import { compareLastActivity, lastActivityByMatter } from "./matter-last-activity";
import {
  listPartiesOf, partiesByMatter,
  type MatterDetailRow, type MatterListFilter, type MatterListLink, type MatterListParty, type MatterListResult,
  type MatterListRow, type MatterRepository,
} from "./matter-repository";

/**
 * Delegaterna repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och
 * `LocalStore`. Tidsposter, utlägg, dokument och tjänsteanteckningar läses för
 * ordningen "senast hänt" (#1967).
 */
export type MatterRepoSource = Pick<IDataStore, "matters" | "timeEntries" | "expenses" | "documents" | "serviceNotes">;

/** Listraden ur delegatens rad med alla (icke-raderade) kopplingar i `contacts`. */
type MatterLinksRow = Matter & { contacts: MatterListLink[]; _count: MatterListRow["_count"] };

/** Ärendets icke-raderade kopplingar med kontaktens id och namn, i `createdAt`-ordning (lista och parter, #1964). */
const LINKS_INCLUDE = {
  where: { deletedAt: null },
  include: { contact: { select: { id: true, name: true } } },
  orderBy: { createdAt: "asc" },
} as const;

/** Listradens relationer: kopplingarna och relations-antalen. */
const LIST_INCLUDE = {
  contacts: LINKS_INCLUDE,
  _count: { select: { documents: true, timeEntries: true, contacts: true } },
} as const;

/** Org-scopat where för listan (replikerar routerns Prisma-where). */
function listWhere(organizationId: OrganizationId, f: MatterListFilter): Record<string, unknown> {
  const ins = (s: string) => ({ contains: s, mode: "insensitive" as const });
  return {
    organizationId,
    deletedAt: null, // mjukt raderade syns inte, som i Postgres (#1678)
    ...(f.status ? { status: f.status } : {}),
    ...(f.employeeId ? { timeEntries: { some: { userId: f.employeeId } } } : {}),
    ...(f.responsibleLawyerId ? { responsibleLawyerId: f.responsibleLawyerId } : {}),
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

/** Listraden: kopplingarna blir `contacts` (klienten) och `parties`. */
function toListRow(r: MatterLinksRow): MatterListRow {
  return { ...r, ...listPartiesOf(r.contacts) };
}

export class InMemoryMatterRepository extends InMemoryRepository<Matter> implements MatterRepository {
  private readonly source: MatterRepoSource;

  constructor(store: MatterRepoSource, now?: () => Date) {
    super(store.matters, now ?? (() => new Date()));
    this.source = store;
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
    if (filter.orderBy === "lastActivity") return this.listByLastActivity(where, filter);
    const [rows, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: LIST_INCLUDE,
      }) as Promise<MatterLinksRow[]>,
      this.delegate.count({ where }),
    ]);
    return { matters: rows.map(toListRow), total };
  }

  /**
   * "Senast hänt" (#1967): alla träffar utan sidindelning, de fyra samlingarna
   * en gång var, sortering och sidan klipps ut. Sidans rader hämtas sedan med
   * samma include som standardlistan och läggs i sorterad ordning.
   */
  private async listByLastActivity(where: Record<string, unknown>, filter: MatterListFilter): Promise<MatterListResult> {
    const hits = (await this.delegate.findMany({ where })) as Matter[];
    const ids = hits.map((m) => m.id);
    const { timeEntries, expenses, documents, serviceNotes } = this.source;
    const byMatter = { where: { matterId: { in: ids } } };
    const posts = await Promise.all([
      timeEntries.findMany(byMatter), expenses.findMany(byMatter), documents.findMany(byMatter), serviceNotes.findMany(byMatter),
    ]);
    const activity = lastActivityByMatter(posts.flat(), ids);
    const start = (filter.page - 1) * filter.pageSize;
    const pageIds = [...hits].sort(compareLastActivity(activity)).slice(start, start + filter.pageSize).map((m) => m.id);
    const rows = (await this.delegate.findMany({ where: { id: { in: pageIds } }, include: LIST_INCLUDE })) as MatterLinksRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = pageIds.flatMap((id) => byId.get(id) ?? []);
    return { matters: ordered.map(toListRow), total: hits.length };
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
