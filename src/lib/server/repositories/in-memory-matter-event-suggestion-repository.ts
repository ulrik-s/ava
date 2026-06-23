/**
 * In-memory `MatterEventSuggestionRepository` (ADR 0020) — browser/offline-impl.
 * document/matter-relations registrerade i relations.ts.
 */

import type { MatterEventSuggestion } from "@/lib/shared/schemas/document";
import type { MatterEventSuggestionId, MatterId, OrganizationId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type {
  MatterEventSuggestionRepository, MatterEventSuggestionRow,
} from "./matter-event-suggestion-repository";

export type MatterEventSuggestionRepoSource = Pick<IDataStore, "matterEventSuggestions">;

export class InMemoryMatterEventSuggestionRepository
  extends InMemoryRepository<MatterEventSuggestion>
  implements MatterEventSuggestionRepository {
  constructor(store: MatterEventSuggestionRepoSource, now?: () => Date) {
    super(store.matterEventSuggestions, now ?? (() => new Date()));
  }

  async listForMatter(matterId: MatterId, organizationId: OrganizationId): Promise<MatterEventSuggestionRow[]> {
    return (await this.delegate.findMany({
      where: {
        status: { not: "REJECTED" },
        document: { matterId, matter: { organizationId } },
      },
      include: { document: { select: { id: true, fileName: true, title: true } } },
      orderBy: { startAt: "asc" },
    })) as MatterEventSuggestionRow[];
  }

  async getByIdInOrg(id: MatterEventSuggestionId, organizationId: OrganizationId): Promise<MatterEventSuggestion | null> {
    const row = (await this.delegate.findFirst({
      where: { id, document: { matter: { organizationId } } },
    })) as (MatterEventSuggestion & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }
}
