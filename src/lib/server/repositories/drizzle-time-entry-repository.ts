/**
 * Drizzle `TimeEntryRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `listUnbilled` joinar users för timtaxan, `flagBilled` bulk-sätter invoiceId.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import { matters, timeEntries, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  LawyerReportTimeEntry, TimeEntryListFilter, TimeEntryListResult, TimeEntryListRow,
  TimeEntryReportFilter, TimeEntryReportRow, TimeEntryRepository, UnbilledTimeEntry,
} from "./time-entry-repository";

/** Org-scopat where för `listForOrg` (utbruten för komplexitet ≤8). */
function listWhere(organizationId: string, opts: TimeEntryListFilter) {
  return and(
    eq(matters.organizationId, organizationId),
    isNull(timeEntries.deletedAt),
    opts.matterId ? eq(timeEntries.matterId, opts.matterId) : undefined,
    opts.userId ? eq(timeEntries.userId, opts.userId) : undefined,
    opts.from ? gte(timeEntries.date, opts.from) : undefined,
    opts.to ? lte(timeEntries.date, opts.to) : undefined,
  );
}

export class DrizzleTimeEntryRepository extends DrizzleRepository<TimeEntry> implements TimeEntryRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(timeEntries), now);
  }

  async listForOrg(organizationId: string, opts: TimeEntryListFilter): Promise<TimeEntryListResult> {
    const where = listWhere(organizationId, opts);
    const base = this.db.select({
      te: timeEntries,
      uId: users.id, uName: users.name,
      mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
    }).from(timeEntries).innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .leftJoin(users, eq(timeEntries.userId, users.id));
    const rows = await base.where(where).orderBy(desc(timeEntries.date))
      .limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
    const [agg] = await this.db
      .select({ total: sql<number>`count(*)`, sum: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)` })
      .from(timeEntries).innerJoin(matters, eq(timeEntries.matterId, matters.id)).where(where);
    return {
      entries: rows.map((r) => ({
        ...(r.te as object),
        user: r.uId ? { id: r.uId, name: r.uName as string } : null,
        matter: { id: r.mId, matterNumber: r.mNum as string, title: r.mTitle as string },
        invoice: null,
      })) as unknown as TimeEntryListRow[],
      total: Number(agg?.total ?? 0),
      totalMinutes: Number(agg?.sum ?? 0),
    };
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<TimeEntry | null> {
    const rows = await this.db
      .select({ te: timeEntries }).from(timeEntries)
      .innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .where(and(eq(timeEntries.id, id), eq(matters.organizationId, organizationId), isNull(timeEntries.deletedAt)))
      .limit(1);
    return this.asRow(rows[0]?.te);
  }

  async listForReport(organizationId: string, filter: TimeEntryReportFilter): Promise<TimeEntryReportRow[]> {
    const klient = sql<string | null>`(select c.name from matter_contacts mc join contacts c on mc.contact_id = c.id where mc.matter_id = ${matters.id} and mc.role = 'KLIENT' limit 1)`;
    const rows = await this.db
      .select({
        te: timeEntries, uId: users.id, uName: users.name,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title, klient,
      })
      .from(timeEntries)
      .innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .where(and(
        eq(matters.organizationId, organizationId),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.date, filter.from),
        lte(timeEntries.date, filter.to),
        filter.matterId ? eq(timeEntries.matterId, filter.matterId) : undefined,
        filter.userIds && filter.userIds.length > 0
          ? inArray(timeEntries.userId, filter.userIds)
          : filter.userId ? eq(timeEntries.userId, filter.userId) : undefined,
      ))
      .orderBy(asc(timeEntries.userId), asc(timeEntries.date));
    return rows.map((r) => ({
      ...(r.te as object),
      user: { id: r.uId as string, name: r.uName as string },
      matter: {
        id: r.mId, matterNumber: r.mNum as string, title: r.mTitle as string,
        contacts: r.klient ? [{ contact: { name: r.klient as string } }] : [],
      },
    })) as unknown as TimeEntryReportRow[];
  }

  async listUnbilled(matterId: string, ids: string[]): Promise<UnbilledTimeEntry[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ te: timeEntries, hourlyRate: users.hourlyRate }).from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(inArray(timeEntries.id, ids), eq(timeEntries.matterId, matterId), isNull(timeEntries.invoiceId)));
    return rows.map((r) => ({
      ...(r.te as object), user: { hourlyRate: r.hourlyRate },
    })) as unknown as UnbilledTimeEntry[];
  }

  async flagBilled(ids: string[], invoiceId: string): Promise<void> {
    if (!ids.length) return;
    await this.db.update(timeEntries).set({ invoiceId } as never).where(inArray(timeEntries.id, ids));
  }

  async listUnfrozenForMatter(matterId: string): Promise<TimeEntry[]> {
    const rows = await this.db
      .select().from(timeEntries)
      .where(and(eq(timeEntries.matterId, matterId), isNull(timeEntries.frozenByBillingRunId), isNull(timeEntries.deletedAt)))
      .orderBy(asc(timeEntries.date));
    return this.asRows(rows);
  }

  async listForLawyerInPeriod(
    organizationId: string, userId: string, from: Date, to: Date,
  ): Promise<LawyerReportTimeEntry[]> {
    const klient = sql<string | null>`(select c.name from matter_contacts mc join contacts c on mc.contact_id = c.id where mc.matter_id = ${matters.id} and mc.role = 'KLIENT' limit 1)`;
    const rows = await this.db
      .select({
        te: timeEntries,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title,
        mPay: matters.paymentMethod, mNote: matters.paymentMethodNote, mDecided: matters.paymentMethodDecidedAt,
        klient,
      })
      .from(timeEntries)
      .innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .where(and(
        eq(matters.organizationId, organizationId), eq(timeEntries.userId, userId),
        gte(timeEntries.date, from), lte(timeEntries.date, to), isNull(timeEntries.deletedAt),
      ))
      .orderBy(asc(timeEntries.date));
    return rows.map((r) => ({
      ...(r.te as object),
      matter: {
        id: r.mId as string, matterNumber: r.mNum as string, title: r.mTitle as string,
        paymentMethod: r.mPay as string, paymentMethodNote: (r.mNote as string | null) ?? null,
        paymentMethodDecidedAt: (r.mDecided as Date | null) ?? null,
        contacts: r.klient ? [{ contact: { name: r.klient as string } }] : [],
      },
    })) as unknown as LawyerReportTimeEntry[];
  }

  async listBillableForOrg(organizationId: string): Promise<TimeEntry[]> {
    const rows = await this.db
      .select({ te: timeEntries }).from(timeEntries)
      .innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .where(and(eq(matters.organizationId, organizationId), eq(timeEntries.billable, true), isNull(timeEntries.deletedAt)));
    return rows.map((r) => r.te) as unknown as TimeEntry[];
  }

  async freezeForMatter(matterId: string, billingRunId: string, now: Date): Promise<void> {
    await this.db.update(timeEntries)
      .set({ frozenAt: now, frozenByBillingRunId: billingRunId } as never)
      .where(and(eq(timeEntries.matterId, matterId), isNull(timeEntries.frozenByBillingRunId)));
  }
}
