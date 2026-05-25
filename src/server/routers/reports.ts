import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

/**
 * Advokat-fokuserade rapporter: användaren väljer period (from/to) och
 * en advokat; en enda procedure hämtar alla tre delrapporter så sidan
 * kan visa dem konsistent.
 *
 * Enheter (samma som resten av kodbasen):
 *   - `TimeEntry.minutes`    — heltal minuter
 *   - `TimeEntry.hourlyRate` — öre/timme (seed-data: 250_000 = 2 500 kr/h)
 *   - `Expense.amount`       — öre
 *   - `Invoice.amount`       — öre
 *
 * Alla kronbelopp som returneras är i **öre** så UI kan använda
 * `formatCurrency()` rakt av.
 */

// ─── ISO-vecka ───────────────────────────────────────────────────────

function isoWeek(d: Date): { year: number; week: number } {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((dt.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return { year: dt.getUTCFullYear(), week };
}

function mondayOfIsoWeek(d: Date): Date {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNr);
  return dt;
}

function weeksInRange(from: Date, to: Date): { isoYear: number; week: number; start: Date; end: Date }[] {
  const weeks: { isoYear: number; week: number; start: Date; end: Date }[] = [];
  let cursor = mondayOfIsoWeek(from);
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(cursor.getUTCDate() + 6);
    const { year, week } = isoWeek(cursor);
    weeks.push({ isoYear: year, week, start: new Date(cursor), end: weekEnd });
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function weekKey(isoYear: number, week: number): string {
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

// ─── Router ──────────────────────────────────────────────────────────

export const reportsRouter = router({
  /**
   * Advokatrapport: en advokat, en period, tre delrapporter.
   *   1. Ärenden advokaten jobbat i under perioden
   *   2. Timdebitering per vecka
   *   3. Upparbetat, icke fakturerat (time entries & billable expenses
   *      utan invoiceId för den advokaten inom perioden)
   */
  perLawyer: protectedProcedure
    .input(z.object({
      from: z.string(),
      to: z.string(),
      userId: z.string(),
    }))
    // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async arrow function has a complexity of 16. Maximum allowed is 8.)
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      toDate.setUTCHours(23, 59, 59, 999);

      const orgScope = { matter: { organizationId: ctx.user.organizationId } };

      const [user, timeEntries, expenses] = await Promise.all([
        ctx.dataStore.users.findFirst({
          where: { id: input.userId, organizationId: ctx.user.organizationId },
          select: { id: true, name: true, hourlyRate: true },
        }),
        ctx.dataStore.timeEntries.findMany({
          where: {
            ...orgScope,
            userId: input.userId,
            date: { gte: fromDate, lte: toDate },
          },
          select: {
            id: true,
            date: true,
            minutes: true,
            billable: true,
            hourlyRate: true,
            description: true,
            invoiceId: true,
            matter: {
              select: {
                id: true,
                matterNumber: true,
                title: true,
                paymentMethod: true,
                paymentMethodNote: true,
                paymentMethodDecidedAt: true,
                contacts: {
                  where: { role: "KLIENT" },
                  select: { contact: { select: { name: true } } },
                  take: 1,
                },
              },
            },
          },
          orderBy: { date: "asc" },
        }),
        ctx.dataStore.expenses.findMany({
          where: {
            ...orgScope,
            userId: input.userId,
            date: { gte: fromDate, lte: toDate },
          },
          select: {
            id: true,
            date: true,
            amount: true,
            billable: true,
            invoiceId: true,
            matter: {
              select: {
                id: true,
                matterNumber: true,
                title: true,
                paymentMethod: true,
                paymentMethodNote: true,
                paymentMethodDecidedAt: true,
                contacts: {
                  where: { role: "KLIENT" },
                  select: { contact: { select: { name: true } } },
                  take: 1,
                },
              },
            },
          },
          orderBy: { date: "asc" },
        }),
      ]);

      if (!user) {
        return null;
      }

      // ─── 1. Ärenden ────────────────────────────────────────────────
      type MatterAgg = {
        matterId: string;
        matterNumber: string;
        title: string;
        client: string | null;
        paymentMethod: string;
        paymentMethodNote: string | null;
        paymentMethodDecidedAt: Date | null;
        totalMinutes: number;
        billableMinutes: number;
        workValueOre: number;     // tid × timpris (öre)
        expenseOre: number;       // utlägg totalt (öre, bara billable)
      };
      const mattersMap = new Map<string, MatterAgg>();

      const ensureMatter = (m: NonNullable<typeof timeEntries[number]["matter"]>): MatterAgg => {
        const existing = mattersMap.get(m.id);
        if (existing) return existing;
        const agg: MatterAgg = {
          matterId: m.id,
          matterNumber: m.matterNumber,
          title: m.title,
          client: m.contacts?.[0]?.contact?.name ?? null,
          paymentMethod: m.paymentMethod,
          paymentMethodNote: m.paymentMethodNote,
          paymentMethodDecidedAt: m.paymentMethodDecidedAt,
          totalMinutes: 0,
          billableMinutes: 0,
          workValueOre: 0,
          expenseOre: 0,
        };
        mattersMap.set(m.id, agg);
        return agg;
      };

      for (const te of timeEntries) {
        const agg = ensureMatter(te.matter);
        agg.totalMinutes += te.minutes;
        if (te.billable) {
          agg.billableMinutes += te.minutes;
          // hourlyRate ÄR REDAN ÖRE (öre/h) → (min/60) × öre/h = öre.
          // Tidigare hade vi en extra * 100 som gjorde värdet 100x för stort.
          agg.workValueOre += Math.round((te.minutes / 60) * te.hourlyRate);
        }
      }
      for (const ex of expenses) {
        const agg = ensureMatter(ex.matter);
        if (ex.billable) agg.expenseOre += ex.amount;
      }

      const matters = Array.from(mattersMap.values()).sort((a, b) =>
        a.matterNumber.localeCompare(b.matterNumber, "sv"),
      );

      // ─── 2. Timdebitering per vecka ────────────────────────────────
      const weeks = weeksInRange(fromDate, toDate);
      const weekGrid = new Map<string, { totalMinutes: number; billableMinutes: number; workValueOre: number }>();
      for (const w of weeks) weekGrid.set(weekKey(w.isoYear, w.week), { totalMinutes: 0, billableMinutes: 0, workValueOre: 0 });

      for (const te of timeEntries) {
        const { year, week } = isoWeek(te.date);
        const cell = weekGrid.get(weekKey(year, week));
        if (!cell) continue;
        cell.totalMinutes += te.minutes;
        if (te.billable) {
          cell.billableMinutes += te.minutes;
          cell.workValueOre += Math.round((te.minutes / 60) * te.hourlyRate);
        }
      }

      const weeklyRows = weeks.map((w) => {
        const cell = weekGrid.get(weekKey(w.isoYear, w.week))!;
        return {
          isoYear: w.isoYear,
          week: w.week,
          start: w.start.toISOString().slice(0, 10),
          end: w.end.toISOString().slice(0, 10),
          ...cell,
        };
      });

      // ─── 3. Upparbetat, icke fakturerat ────────────────────────────
      // Summan av debiterbar tid+utlägg för advokaten inom perioden där
      // posten ännu inte är knuten till en faktura.
      type UnbilledRow = {
        matterId: string;
        matterNumber: string;
        title: string;
        client: string | null;
        paymentMethod: string;
        timeOre: number;
        expenseOre: number;
        total: number;
      };
      const unbilledMap = new Map<string, UnbilledRow>();
      const ensureUnbilled = (m: NonNullable<typeof timeEntries[number]["matter"]>): UnbilledRow => {
        const existing = unbilledMap.get(m.id);
        if (existing) return existing;
        const row: UnbilledRow = {
          matterId: m.id,
          matterNumber: m.matterNumber,
          title: m.title,
          client: m.contacts?.[0]?.contact?.name ?? null,
          paymentMethod: m.paymentMethod,
          timeOre: 0,
          expenseOre: 0,
          total: 0,
        };
        unbilledMap.set(m.id, row);
        return row;
      };

      let unbilledTotal = 0;
      for (const te of timeEntries) {
        if (!te.billable || te.invoiceId) continue;
        const ore = Math.round((te.minutes / 60) * te.hourlyRate);
        const row = ensureUnbilled(te.matter);
        row.timeOre += ore;
        row.total += ore;
        unbilledTotal += ore;
      }
      for (const ex of expenses) {
        if (!ex.billable || ex.invoiceId) continue;
        const row = ensureUnbilled(ex.matter);
        row.expenseOre += ex.amount;
        row.total += ex.amount;
        unbilledTotal += ex.amount;
      }

      const unbilledRows = Array.from(unbilledMap.values())
        .filter((r) => r.total > 0)
        .sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv"));

      // ─── Totaler ───────────────────────────────────────────────────
      const totals = matters.reduce(
        (acc, m) => ({
          totalMinutes: acc.totalMinutes + m.totalMinutes,
          billableMinutes: acc.billableMinutes + m.billableMinutes,
          workValueOre: acc.workValueOre + m.workValueOre,
          expenseOre: acc.expenseOre + m.expenseOre,
        }),
        { totalMinutes: 0, billableMinutes: 0, workValueOre: 0, expenseOre: 0 },
      );

      return {
        user: { id: user.id, name: user.name, hourlyRate: user.hourlyRate },
        period: { from: input.from, to: input.to },
        matters,
        weeklyRows,
        unbilled: { rows: unbilledRows, total: unbilledTotal },
        totals,
      };
    }),
});
