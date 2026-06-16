/**
 * In-memory `MatterRepository` (ADR 0020) — browser/offline-impl. Ärver bas-CRUD
 * och org-scopar direkt på `organizationId` (ärenden saknar relations-beroende).
 */

import type { Matter } from "@/lib/shared/schemas/matter";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { MatterRepository } from "./matter-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type MatterRepoSource = Pick<IDataStore, "matters">;

export class InMemoryMatterRepository extends InMemoryRepository<Matter> implements MatterRepository {
  constructor(store: MatterRepoSource, now?: () => Date) {
    super(store.matters as unknown as Delegate, now ?? (() => new Date()));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<Matter | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as Matter | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
