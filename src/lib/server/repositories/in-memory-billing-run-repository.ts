/**
 * In-memory `BillingRunRepository` (ADR 0020) — browser/offline-impl.
 * Org-scopning via samma relations-where routern använde (`matter`).
 */

import type { BillingRun } from "@/lib/shared/schemas/billing";
import type { Delegate, IDataStore } from "../data-store/IDataStore";
import type {
  BillingRunDetailRow, BillingRunListRow, BillingRunRepository,
} from "./billing-run-repository";
import { InMemoryRepository } from "./in-memory-repository";

export type BillingRunRepoSource = Pick<IDataStore, "billingRuns">;

export class InMemoryBillingRunRepository
  extends InMemoryRepository<BillingRun>
  implements BillingRunRepository {
  constructor(store: BillingRunRepoSource, now?: () => Date) {
    super(store.billingRuns as unknown as Delegate, now ?? (() => new Date()));
  }

  async listForOrg(organizationId: string, matterId?: string): Promise<BillingRunListRow[]> {
    return (await this.delegate.findMany({
      where: { ...(matterId ? { matterId } : {}), matter: { organizationId } },
      orderBy: { createdAt: "desc" },
      include: { invoice: { select: { id: true, invoiceNumber: true, status: true } } },
    })) as BillingRunListRow[];
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<BillingRunDetailRow | null> {
    const row = (await this.delegate.findFirst({
      where: { id, matter: { organizationId } },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, status: true, amount: true } },
        matter: { select: { id: true, matterNumber: true, title: true, paymentMethod: true } },
      },
    })) as (BillingRunDetailRow & { deletedAt?: unknown }) | null;
    return row && !row.deletedAt ? row : null;
  }

  async listAccontoSent(matterId: string): Promise<BillingRun[]> {
    return (await this.delegate.findMany({
      where: { matterId, type: "ACCONTO", status: "SENT" },
    })) as BillingRun[];
  }

  async listAccontoByIds(matterId: string, ids: string[]): Promise<BillingRun[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, matterId, type: "ACCONTO" },
    })) as BillingRun[];
  }
}
