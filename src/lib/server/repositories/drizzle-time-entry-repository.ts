/**
 * Drizzle `TimeEntryRepository` (ADR 0020) — server-impl. Ärver bas-CRUD;
 * `listUnbilled` joinar users för timtaxan, `flagBilled` bulk-sätter invoiceId.
 *
 * `timeEntries`-kolumnerna är brandade (#562) → `select({ te: timeEntries })` bär
 * branded id:n och projektionernas \`...r.te\`-spread är typad (ingen \`as object\`).
 * Query-params brandas vid gränsen med \`asId\` (en typad tag, inte en dubbel-cast).
 * Kvarvarande \`as string\`/\`as Date\` på join-fälten är enkla narrowing-castar av
 * leftJoin-nullbara select-värden, inte \`as unknown as\`.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { TimeEntry } from "@/lib/shared/schemas/billing";
import { asId, type BillingRunId, type InvoiceId, type MatterId, type OrganizationId, type TimeEntryId, type UserId } from "@/lib/shared/schemas/ids";
import { matters, timeEntries, users } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { matterOrg } from "./matter-org";
import type {
  LawyerReportTimeEntry, TimeEntryListFilter, TimeEntryListResult, TimeEntryListRow,
  TimeEntryReportFilter, TimeEntryReportRow, TimeEntryRepository, UnbilledTimeEntry,
} from "./time-entry-repository";

/** Org-scopat where för `listForOrg` (utbruten för komplexitet ≤8). */
function listWhere(organizationId: OrganizationId, opts: TimeEntryListFilter) {
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

  /** time_entries saknar org-kolumn → härled via ärendet (#528/#632) så change_log/pull funkar. */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: MatterId }).matterId);
  }

  async listForOrg(organizationId: OrganizationId, opts: TimeEntryListFilter): Promise<TimeEntryListResult> {
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
      entries: rows.map((r): TimeEntryListRow => ({
        ...r.te,
        user: r.uId ? { id: asId<"UserId">(r.uId), name: r.uName ?? "" } : null,
        matter: { id: r.mId, matterNumber: r.mNum, title: r.mTitle },
        invoice: null,
      })),
      total: Number(agg?.total ?? 0),
      totalMinutes: Number(agg?.sum ?? 0),
    };
  }

  async getByIdInOrg(id: TimeEntryId, organizationId: OrganizationId): Promise<TimeEntry | null> {
    const rows = await this.db
      .select({ te: timeEntries }).from(timeEntries)
      .innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .where(and(eq(timeEntries.id, id), eq(matters.organizationId, organizationId), isNull(timeEntries.deletedAt)))
      .limit(1);
    return rows[0]?.te ?? null;
  }

  async listForReport(organizationId: OrganizationId, filter: TimeEntryReportFilter): Promise<TimeEntryReportRow[]> {
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
    return rows.map((r): TimeEntryReportRow => ({
      ...r.te,
      user: { id: asId<"UserId">(r.uId ?? ""), name: r.uName ?? "" },
      matter: {
        id: r.mId, matterNumber: r.mNum, title: r.mTitle,
        contacts: r.klient ? [{ contact: { name: r.klient } }] : [],
      },
    }));
  }

  async listUnbilled(matterId: MatterId, ids: TimeEntryId[]): Promise<UnbilledTimeEntry[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ te: timeEntries, hourlyRate: users.hourlyRate }).from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(inArray(timeEntries.id, ids), eq(timeEntries.matterId, matterId), isNull(timeEntries.invoiceId)));
    return rows.map((r): UnbilledTimeEntry => ({
      ...r.te, user: { hourlyRate: r.hourlyRate },
    }));
  }

  async flagBilled(ids: TimeEntryId[], invoiceId: InvoiceId): Promise<void> {
    if (!ids.length) return;
    await this.db.update(timeEntries).set({ invoiceId })
      .where(inArray(timeEntries.id, ids));
  }

  async listUnfrozenForMatter(matterId: MatterId): Promise<TimeEntry[]> {
    const rows = await this.db
      .select().from(timeEntries)
      .where(and(eq(timeEntries.matterId, matterId), isNull(timeEntries.frozenByBillingRunId), isNull(timeEntries.deletedAt)))
      .orderBy(asc(timeEntries.date));
    return rows;
  }

  async listForLawyerInPeriod(
    organizationId: OrganizationId, userId: UserId, from: Date, to: Date,
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
    return rows.map((r): LawyerReportTimeEntry => ({
      ...r.te,
      matter: {
        id: r.mId, matterNumber: r.mNum, title: r.mTitle,
        paymentMethod: r.mPay, paymentMethodNote: r.mNote ?? null,
        paymentMethodDecidedAt: r.mDecided ?? null,
        contacts: r.klient ? [{ contact: { name: r.klient } }] : [],
      },
    }));
  }

  async listBillableForOrg(organizationId: OrganizationId): Promise<TimeEntry[]> {
    const rows = await this.db
      .select({ te: timeEntries }).from(timeEntries)
      .innerJoin(matters, eq(timeEntries.matterId, matters.id))
      .where(and(eq(matters.organizationId, organizationId), eq(timeEntries.billable, true), isNull(timeEntries.deletedAt)));
    return rows.map((r) => r.te);
  }

  async freezeForMatter(matterId: MatterId, billingRunId: BillingRunId, now: Date): Promise<void> {
    await this.db.update(timeEntries)
      .set({ frozenAt: now, frozenByBillingRunId: billingRunId })
      .where(and(eq(timeEntries.matterId, matterId), isNull(timeEntries.frozenByBillingRunId)));
  }

  async freezeByIds(ids: TimeEntryId[], billingRunId: BillingRunId, now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(timeEntries)
      .set({ frozenAt: now, frozenByBillingRunId: billingRunId })
      .where(and(inArray(timeEntries.id, ids), isNull(timeEntries.frozenByBillingRunId)));
  }
}
