/**
 * In-memory `InterrogationRepository` (ADR 0020) — browser/offline-impl (#1855).
 */

import type { InterrogationId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { Interrogation } from "@/lib/shared/schemas/interrogation";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { InterrogationRepository } from "./interrogation-repository";

export type InterrogationRepoSource = Pick<IDataStore, "interrogations">;

export class InMemoryInterrogationRepository
  extends InMemoryRepository<Interrogation>
  implements InterrogationRepository {
  constructor(store: InterrogationRepoSource, now?: () => Date) {
    super(store.interrogations, now ?? (() => new Date()));
  }

  async listForMatter(organizationId: OrganizationId, matterId: MatterId): Promise<Interrogation[]> {
    const rows = (await this.delegate.findMany({
      where: { organizationId, matterId },
      orderBy: { start: "asc" },
    })) as Interrogation[];
    return rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);
  }

  async getByIdInOrg(id: InterrogationId, organizationId: OrganizationId): Promise<Interrogation | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as Interrogation | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
