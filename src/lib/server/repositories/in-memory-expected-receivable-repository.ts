/**
 * In-memory `ExpectedReceivableRepository` (ADR 0020) — browser/offline-impl.
 */

import type { ExpectedReceivable } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import type { ExpectedReceivableListFilter, ExpectedReceivableRepository } from "./expected-receivable-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type ExpectedReceivableRepoSource = Pick<IDataStore, "expectedReceivables">;

export class InMemoryExpectedReceivableRepository
  extends InMemoryRepository<ExpectedReceivable>
  implements ExpectedReceivableRepository {
  constructor(store: ExpectedReceivableRepoSource, now?: () => Date) {
    super(store.expectedReceivables as unknown as Delegate, now ?? (() => new Date()));
  }

  async listForOrg(organizationId: string, filter?: ExpectedReceivableListFilter): Promise<ExpectedReceivable[]> {
    return (await this.delegate.findMany({
      where: {
        organizationId,
        ...(filter?.matterId ? { matterId: filter.matterId } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    })) as ExpectedReceivable[];
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<ExpectedReceivable | null> {
    const row = (await this.delegate.findFirst({ where: { id, organizationId } })) as ExpectedReceivable | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }
}
