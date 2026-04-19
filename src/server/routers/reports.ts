import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

/**
 * Reports that aggregate data across matters/users for the whole firm.
 *
 * Unit conventions (matches the rest of the codebase):
 *   - `TimeEntry.minutes`       — integer minutes
 *   - `TimeEntry.hourlyRate`    — kronor per hour (NOT öre; confirmed via
 *                                 seed value 2500 and the users UI showing
 *                                 `{hourlyRate} kr/h` directly)
 *   - `Expense.amount`          — öre
 *   - `Invoice.amount`          — öre (follows Expense precedent; Invoice
 *                                 has no persisted UI yet)
 *
 * All monetary values returned by these procedures are in **öre** so the
 * client can use `formatCurrency()` uniformly.
 */

// ─── Date helpers ────────────────────────────────────────────────────

/** ISO-8601 week number (ISO calendar used in Sweden). */
function isoWeek(d: Date): { year: number; week: number } {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (dt.getUTCDay() + 6) % 7;             // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3);         // Thursday of this week
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((dt.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return { year: dt.getUTCFullYear(), week };
}

/** All ISO weeks in a given ISO-week year, as {week, start, end} Monday→Sunday. */
function weeksInYear(year: number): { week: number; start: Date; end: Date }[] {
  // Jan 4 is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  const dayNr = (jan4.getUTCDay() + 6) % 7;
  firstMonday.setUTCDate(jan4.getUTCDate() - dayNr);

  const weeks: { week: number; start: Date; end: Date }[] = [];
  let cursor = new Date(firstMonday);
  let week = 1;
  while (true) {
    const end = new Date(cursor);
    end.setUTCDate(cursor.getUTCDate() + 6);
    const { year: isoY } = isoWeek(cursor);
    if (isoY !== year) break;
    weeks.push({ week, start: new Date(cursor), end });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    week++;
  }
  return weeks;
}

// ─── Router ──────────────────────────────────────────────────────────

export const reportsRouter = router({
  /**
   * Weekly billable-hours breakdown for the whole firm, for one calendar
   * (ISO) year. Rows = ISO weeks, columns = users.
   */
  weeklyByUser: protectedProcedure
    .input(z.object({
      year: z.number().int().min(2000).max(2100),
      userIds: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const weeks = weeksInYear(input.year);
      const yearStart = weeks[0].start;
      const yearEnd = new Date(weeks[weeks.length - 1].end);
      yearEnd.setUTCHours(23, 59, 59, 999);

      const userFilter = input.userIds && input.userIds.length > 0
        ? { userId: { in: input.userIds } }
        : {};

      const entries = await ctx.prisma.timeEntry.findMany({
        where: {
          matter: { organizationId: ctx.user.organizationId },
          date: { gte: yearStart, lte: yearEnd },
          ...userFilter,
        },
        select: {
          userId: true,
          date: true,
          minutes: true,
          billable: true,
          user: { select: { name: true } },
        },
      });

      // Collect users seen.
      const users = new Map<string, string>();
      for (const e of entries) users.set(e.userId, e.user.name);

      // Build cell grid: weekIndex → userId → { total, billable }.
      const grid = new Map<number, Map<string, { total: number; billable: number }>>();
      for (const w of weeks) grid.set(w.week, new Map());

      const totalsPerUser = new Map<string, { total: number; billable: number }>();
      let grandTotal = 0;
      let grandBillable = 0;

      for (const e of entries) {
        const { week } = isoWeek(e.date);
        const row = grid.get(week);
        if (!row) continue;                // entry in adjacent year's week
        const cell = row.get(e.userId) ?? { total: 0, billable: 0 };
        cell.total += e.minutes;
        if (e.billable) cell.billable += e.minutes;
        row.set(e.userId, cell);

        const ut = totalsPerUser.get(e.userId) ?? { total: 0, billable: 0 };
        ut.total += e.minutes;
        if (e.billable) ut.billable += e.minutes;
        totalsPerUser.set(e.userId, ut);

        grandTotal += e.minutes;
        if (e.billable) grandBillable += e.minutes;
      }

      const userList = Array.from(users, ([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv"));

      return {
        year: input.year,
        users: userList,
        weeks: weeks.map((w) => ({
          week: w.week,
          start: w.start.toISOString().slice(0, 10),
          end: w.end.toISOString().slice(0, 10),
          cells: userList.map((u) => grid.get(w.week)!.get(u.id) ?? { total: 0, billable: 0 }),
          rowTotal: userList.reduce((acc, u) => {
            const c = grid.get(w.week)!.get(u.id);
            return acc + (c?.total ?? 0);
          }, 0),
          rowBillable: userList.reduce((acc, u) => {
            const c = grid.get(w.week)!.get(u.id);
            return acc + (c?.billable ?? 0);
          }, 0),
        })),
        userTotals: userList.map((u) => totalsPerUser.get(u.id) ?? { total: 0, billable: 0 }),
        grandTotal,
        grandBillable,
      };
    }),

  /**
   * "Upparbetat, icke fakturerat" — yearly roll-up of:
   *   - Upparbetat (billable work value)
   *     = Σ (TimeEntry.minutes/60 * TimeEntry.hourlyRate * 100)  [kr→öre]
   *     + Σ Expense.amount (where billable)
   *   - Fakturerat     = Σ Invoice.amount where status ∈ {SENT, PAID}
   *   - Kundförlust    = Σ Invoice.amount where status = BAD_DEBT
   *   - WIP för året   = Upparbetat – Fakturerat – Kundförlust
   *
   * All amounts in öre.
   */
  workInProgressYearly: protectedProcedure
    .input(z.object({
      // Optional window; if absent, spans from oldest data to the current year.
      fromYear: z.number().int().optional(),
      toYear: z.number().int().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const orgWhere = { matter: { organizationId: ctx.user.organizationId } };

      const [timeEntries, expenses, invoices] = await Promise.all([
        ctx.prisma.timeEntry.findMany({
          where: { ...orgWhere, billable: true },
          select: { date: true, minutes: true, hourlyRate: true },
        }),
        ctx.prisma.expense.findMany({
          where: { ...orgWhere, billable: true },
          select: { date: true, amount: true },
        }),
        ctx.prisma.invoice.findMany({
          where: orgWhere,
          select: { invoiceDate: true, amount: true, status: true },
        }),
      ]);

      interface Row { upparbetat: number; fakturerat: number; kundforlust: number; }
      const byYear = new Map<number, Row>();
      const ensure = (y: number) => {
        let r = byYear.get(y);
        if (!r) { r = { upparbetat: 0, fakturerat: 0, kundforlust: 0 }; byYear.set(y, r); }
        return r;
      };

      for (const te of timeEntries) {
        const y = te.date.getFullYear();
        // kronor → öre: × 100
        const ore = Math.round((te.minutes / 60) * te.hourlyRate * 100);
        ensure(y).upparbetat += ore;
      }
      for (const ex of expenses) {
        ensure(ex.date.getFullYear()).upparbetat += ex.amount;
      }
      for (const inv of invoices) {
        const y = inv.invoiceDate.getFullYear();
        const r = ensure(y);
        if (inv.status === "SENT" || inv.status === "PAID") r.fakturerat += inv.amount;
        else if (inv.status === "BAD_DEBT") r.kundforlust += inv.amount;
      }

      let years = Array.from(byYear.keys()).sort((a, b) => a - b);
      if (input?.fromYear) years = years.filter((y) => y >= input.fromYear!);
      if (input?.toYear) years = years.filter((y) => y <= input.toYear!);

      // Ensure current year is always present so an empty firm still shows a row.
      const currentYear = new Date().getFullYear();
      if (years.length === 0) years = [currentYear];

      let cumulativeWip = 0;
      const rows = years.map((y) => {
        const r = byYear.get(y) ?? { upparbetat: 0, fakturerat: 0, kundforlust: 0 };
        const yearWip = r.upparbetat - r.fakturerat - r.kundforlust;
        cumulativeWip += yearWip;
        return { year: y, ...r, yearWip, cumulativeWip };
      });

      const totals = rows.reduce(
        (acc, r) => ({
          upparbetat: acc.upparbetat + r.upparbetat,
          fakturerat: acc.fakturerat + r.fakturerat,
          kundforlust: acc.kundforlust + r.kundforlust,
          wip: acc.wip + r.yearWip,
        }),
        { upparbetat: 0, fakturerat: 0, kundforlust: 0, wip: 0 },
      );

      return { rows, totals };
    }),
});
