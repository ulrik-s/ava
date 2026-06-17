/**
 * In-memory `ServiceNoteRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; list/ägar-vakt org-scopar via ärendet (samma relations-where som routern).
 */

import type { ServiceNote } from "@/lib/shared/schemas/service-note";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { ServiceNoteRepository, ServiceNoteRow } from "./service-note-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type ServiceNoteRepoSource = Pick<IDataStore, "serviceNotes">;

export class InMemoryServiceNoteRepository extends InMemoryRepository<ServiceNote> implements ServiceNoteRepository {
  constructor(store: ServiceNoteRepoSource, now?: () => Date) {
    super(store.serviceNotes as unknown as Delegate, now ?? (() => new Date()));
  }

  async listByMatter(matterId: string, organizationId: string): Promise<ServiceNoteRow[]> {
    return (await this.delegate.findMany({
      where: { matterId, matter: { organizationId } },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true } } },
    })) as ServiceNoteRow[];
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<ServiceNote | null> {
    const row = (await this.delegate
      .findFirst({ where: { id, matter: { organizationId } } })) as ServiceNote | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
