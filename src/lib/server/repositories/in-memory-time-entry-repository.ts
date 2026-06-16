/**
 * In-memory `TimeEntryRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `listUnbilled` använder samma include som routern (user.hourlyRate),
 * `flagBilled` bulk-uppdaterar invoiceId via delegaten.
 */

import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type { TimeEntryRepository, UnbilledTimeEntry } from "./time-entry-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type TimeEntryRepoSource = Pick<IDataStore, "timeEntries">;

export class InMemoryTimeEntryRepository extends InMemoryRepository<TimeEntry> implements TimeEntryRepository {
  constructor(store: TimeEntryRepoSource, now?: () => Date) {
    super(store.timeEntries as unknown as Delegate, now ?? (() => new Date()));
  }

  async listUnbilled(matterId: string, ids: string[]): Promise<UnbilledTimeEntry[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, matterId, invoiceId: null },
      include: { user: { select: { hourlyRate: true } } },
    })) as UnbilledTimeEntry[];
  }

  async flagBilled(ids: string[], invoiceId: string): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({ where: { id: { in: ids } }, data: { invoiceId } as Partial<TimeEntry> });
  }
}
