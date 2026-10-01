/**
 * In-memory `ConflictCheckRepository` (ADR 0020) — browser/offline-impl.
 */

import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { ConflictCheck } from "@/lib/shared/schemas/misc";
import type { IDataStore } from "../data-store/IDataStore";
import type { ConflictCheckRepository, ConflictCheckRow } from "./conflict-check-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type ConflictCheckRepoSource = Pick<IDataStore, "conflictChecks" | "users">;

export class InMemoryConflictCheckRepository
  extends InMemoryRepository<ConflictCheck>
  implements ConflictCheckRepository {
  private readonly users: ConflictCheckRepoSource["users"];

  constructor(store: ConflictCheckRepoSource, now?: () => Date) {
    super(store.conflictChecks, now ?? (() => new Date()));
    this.users = store.users;
  }

  /** Byråns historik (#1344): sökningar gjorda av byråns användare. */
  async listHistory(organizationId: OrganizationId, page: number, pageSize: number): Promise<{ checks: ConflictCheckRow[]; total: number }> {
    const members = await this.users.findMany({ where: { organizationId } });
    const where = { checkedById: { in: members.map((u) => u.id) } };
    const [checks, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { checkedBy: { select: { name: true } } },
      }) as Promise<ConflictCheckRow[]>,
      this.delegate.count({ where }),
    ]);
    return { checks, total };
  }
}
