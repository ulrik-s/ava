/**
 * In-memory `ConflictCheckRepository` (ADR 0020) — browser/offline-impl.
 */

import type { ConflictCheck } from "@/lib/shared/schemas/misc";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import type { ConflictCheckRepository, ConflictCheckRow } from "./conflict-check-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type ConflictCheckRepoSource = Pick<IDataStore, "conflictChecks">;

export class InMemoryConflictCheckRepository
  extends InMemoryRepository<ConflictCheck>
  implements ConflictCheckRepository {
  constructor(store: ConflictCheckRepoSource, now?: () => Date) {
    super(store.conflictChecks as unknown as Delegate, now ?? (() => new Date()));
  }

  async listHistory(page: number, pageSize: number): Promise<{ checks: ConflictCheckRow[]; total: number }> {
    const [checks, total] = await Promise.all([
      this.delegate.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { checkedBy: { select: { name: true } } },
      }) as Promise<ConflictCheckRow[]>,
      this.delegate.count({}),
    ]);
    return { checks, total };
  }
}
