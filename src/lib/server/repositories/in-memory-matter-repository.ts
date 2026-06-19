/**
 * In-memory `MatterRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD
 * och org-scopar direkt på `organizationId` (ärenden saknar relations-beroende).
 */

import type { Matter } from "@/lib/shared/schemas/matter";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type {
  MatterDetailRow, MatterListFilter, MatterListResult, MatterListRow, MatterRepository,
} from "./matter-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type MatterRepoSource = Pick<IDataStore, "matters">;

/** Org-scopat where för listan (replikerar routerns Prisma-where). */
function listWhere(organizationId: string, f: MatterListFilter): Record<string, unknown> {
  const ins = (s: string) => ({ contains: s, mode: "insensitive" as const });
  return {
    organizationId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.employeeId ? { timeEntries: { some: { userId: f.employeeId } } } : {}),
    ...(f.search
      ? {
          OR: [
            { title: ins(f.search) },
            { matterNumber: ins(f.search) },
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

  async getByIdInOrg(id: string, organizationId: string): Promise<Matter | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as Matter | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listByOrg(organizationId: string): Promise<Matter[]> {
    const rows = (await this.delegate.findMany({ where: { organizationId } })) as Matter[];
    return rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);
  }

  async listForOrg(organizationId: string, filter: MatterListFilter): Promise<MatterListResult> {
    const where = listWhere(organizationId, filter);
    const [matters, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: {
          contacts: { where: { role: "KLIENT" }, include: { contact: { select: { id: true, name: true } } }, take: 1 },
          _count: { select: { documents: true, timeEntries: true, contacts: true } },
        },
      }) as Promise<MatterListRow[]>,
      this.delegate.count({ where }),
    ]);
    return { matters, total };
  }

  async getByIdWithContacts(id: string, organizationId: string): Promise<MatterDetailRow | null> {
    const row = (await this.delegate.findFirst({
      where: { id, organizationId },
      include: {
        contacts: { include: { contact: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { documents: true, timeEntries: true, emails: true } },
      },
    })) as (MatterDetailRow & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }

  async listByResponsibleLawyer(organizationId: string, responsibleLawyerId: string): Promise<Matter[]> {
    return (await this.delegate.findMany({ where: { organizationId, responsibleLawyerId } })) as Matter[];
  }

  async listByNumberPrefix(organizationId: string, prefix: string): Promise<Matter[]> {
    return (await this.delegate.findMany({
      where: { organizationId, matterNumber: { startsWith: prefix } },
    })) as Matter[];
  }
}
