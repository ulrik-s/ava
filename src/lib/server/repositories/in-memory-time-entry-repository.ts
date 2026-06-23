/**
 * In-memory `TimeEntryRepository` (ADR 0020) — browser/offline-impl. Ärver
 * bas-CRUD; `listUnbilled` använder samma include som routern (user.hourlyRate),
 * `flagBilled` bulk-uppdaterar invoiceId via delegaten.
 */

import type { TimeEntry } from "@/lib/shared/schemas/billing";
import type { BillingRunId, InvoiceId, MatterId, OrganizationId, TimeEntryId, UserId } from "@/lib/shared/schemas/ids";
import type { IDataStore } from "../data-store/IDataStore";
import { InMemoryRepository } from "./in-memory-repository";
import type {
  LawyerReportTimeEntry, TimeEntryListFilter, TimeEntryListResult, TimeEntryListRow,
  TimeEntryReportFilter, TimeEntryReportRow, TimeEntryRepository, UnbilledTimeEntry,
} from "./time-entry-repository";

/** Delegaten repot behöver — uppfylls av `IDataStore`, `DataStoreTx` och `LocalStore`. */
export type TimeEntryRepoSource = Pick<IDataStore, "timeEntries">;

function dateRange(from?: Date, to?: Date): Record<string, unknown> {
  if (!from && !to) return {};
  return { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } };
}

export class InMemoryTimeEntryRepository extends InMemoryRepository<TimeEntry> implements TimeEntryRepository {
  constructor(store: TimeEntryRepoSource, now?: () => Date) {
    super(store.timeEntries, now ?? (() => new Date()));
  }

  async listForOrg(organizationId: OrganizationId, opts: TimeEntryListFilter): Promise<TimeEntryListResult> {
    const where = {
      matter: { organizationId },
      ...(opts.matterId ? { matterId: opts.matterId } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...dateRange(opts.from, opts.to),
    };
    const [entries, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          user: { select: { id: true, name: true } },
          matter: { select: { id: true, matterNumber: true, title: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }) as Promise<TimeEntryListRow[]>,
      this.delegate.count({ where }),
    ]);
    const agg = await this.delegate.aggregate({ where, _sum: { minutes: true } });
    return { entries, total, totalMinutes: (agg as { _sum?: { minutes?: number } })._sum?.minutes ?? 0 };
  }

  async getByIdInOrg(id: TimeEntryId, organizationId: OrganizationId): Promise<TimeEntry | null> {
    const row = (await this.delegate.findFirst({ where: { id, matter: { organizationId } } })) as TimeEntry | null;
    return row && !(row as { deletedAt?: unknown }).deletedAt ? row : null;
  }

  async listForReport(organizationId: OrganizationId, filter: TimeEntryReportFilter): Promise<TimeEntryReportRow[]> {
    const userFilter = filter.userIds && filter.userIds.length > 0
      ? { userId: { in: filter.userIds } }
      : filter.userId
        ? { userId: filter.userId }
        : {};
    return (await this.delegate.findMany({
      where: {
        matter: { organizationId },
        date: { gte: filter.from, lte: filter.to },
        ...userFilter,
        ...(filter.matterId ? { matterId: filter.matterId } : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        // Nested relations måste gå via `include` (in-memory-motorn rekurserar
        // bara i include-subträd, inte select). Skalärfält följer med ändå.
        matter: {
          include: {
            contacts: {
              where: { role: "KLIENT" }, take: 1,
              include: { contact: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: [{ userId: "asc" }, { date: "asc" }],
    })) as TimeEntryReportRow[];
  }

  async listUnbilled(matterId: MatterId, ids: TimeEntryId[]): Promise<UnbilledTimeEntry[]> {
    if (!ids.length) return [];
    return (await this.delegate.findMany({
      where: { id: { in: ids }, matterId, invoiceId: null },
      include: { user: { select: { hourlyRate: true } } },
    })) as UnbilledTimeEntry[];
  }

  async flagBilled(ids: TimeEntryId[], invoiceId: InvoiceId): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({ where: { id: { in: ids } }, data: { invoiceId } as Partial<TimeEntry> });
  }

  async listUnfrozenForMatter(matterId: MatterId): Promise<TimeEntry[]> {
    return (await this.delegate.findMany({
      where: { matterId, frozenByBillingRunId: null }, orderBy: { date: "asc" },
    })) as TimeEntry[];
  }

  async freezeForMatter(matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void> {
    await this.delegate.updateMany({
      where: { matterId, frozenByBillingRunId: null },
      data: { frozenAt: now, frozenByBillingRunId: billingRunId } as Partial<TimeEntry>,
    });
  }

  async freezeByIds(ids: TimeEntryId[], billingRunId: BillingRunId, now: Date): Promise<void> {
    if (!ids.length) return;
    await this.delegate.updateMany({
      where: { id: { in: ids }, frozenByBillingRunId: null },
      data: { frozenAt: now, frozenByBillingRunId: billingRunId } as Partial<TimeEntry>,
    });
  }

  async listForLawyerInPeriod(
    organizationId: OrganizationId, userId: UserId, from: Date, to: Date,
  ): Promise<LawyerReportTimeEntry[]> {
    return (await this.delegate.findMany({
      where: { matter: { organizationId }, userId, date: { gte: from, lte: to } },
      include: { matter: { include: { contacts: { where: { role: "KLIENT" }, include: { contact: { select: { name: true } } }, take: 1 } } } },
      orderBy: { date: "asc" },
    })) as LawyerReportTimeEntry[];
  }

  async listBillableForOrg(organizationId: OrganizationId): Promise<TimeEntry[]> {
    return (await this.delegate.findMany({
      where: { matter: { organizationId }, billable: true },
    })) as TimeEntry[];
  }
}
