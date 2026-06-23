/**
 * In-memory `OfficeRepository` (ADR 0020) — browser/offline-impl.
 */

import type { OfficeId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Office } from "@/lib/shared/schemas/organization";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { OfficeRepository } from "./office-repository";

export type OfficeRepoSource = Pick<IDataStore, "offices">;

export class InMemoryOfficeRepository extends InMemoryRepository<Office> implements OfficeRepository {
  constructor(store: OfficeRepoSource, now?: () => Date) {
    super(store.offices, now ?? (() => new Date()));
  }

  async listByOrg(organizationId: OrganizationId): Promise<Office[]> {
    return (await this.delegate.findMany({
      where: { organizationId },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    })) as Office[];
  }

  async getByIdInOrg(id: OfficeId, organizationId: OrganizationId): Promise<Office | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as Office | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async demoteMains(organizationId: OrganizationId): Promise<void> {
    await this.delegate.updateMany({
      where: { organizationId, isMain: true },
      data: { isMain: false } as Partial<Office>,
    });
  }
}
