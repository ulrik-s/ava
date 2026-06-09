import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import {
  billedPerLawyer,
  type BilledInvoiceInput,
  type FrozenWorkInput,
} from "@/lib/shared/billed-per-lawyer";
import { computeArBridge, computeAging, scopeArToPeriod, attributeArToLawyer, perInvoiceRows } from "@/lib/shared/ar-summary";

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

// ─── Hjälpare för "Fakturerat per advokat" (#90) ─────────────────────

/** Demo-projektionen lagrar datum som ISO-strängar → coerca till Date. */
function coerceDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}

interface RawTimeEntry {
  userId: string; minutes: number; hourlyRate: number;
  invoiceId: string | null | undefined; frozenByBillingRunId: string | null | undefined;
}
interface RawInvoice { id: string; amount: number; status: string; invoiceDate: unknown; updatedAt: unknown }

/** Karta frozen tidsposter → arbetsvärde per (faktura, advokat). En post knyts
 *  till sin faktura via direkt `invoiceId` (legacy) eller via BillingRun. */
function buildFrozenWork(
  timeEntries: RawTimeEntry[],
  runToInvoice: Map<string, string>,
): FrozenWorkInput[] {
  const out: FrozenWorkInput[] = [];
  for (const te of timeEntries) {
    const invoiceId = te.invoiceId ?? (te.frozenByBillingRunId ? runToInvoice.get(te.frozenByBillingRunId) : undefined);
    if (!invoiceId) continue;
    out.push({ invoiceId, userId: te.userId, workOre: Math.round((te.minutes / 60) * te.hourlyRate) });
  }
  return out;
}

/** invoiceId → advokatens andel (userWork/totalWork ∈ [0,1]) ur frysta tidsposter. */
function lawyerShareRatios(frozenWork: FrozenWorkInput[], userId: string): Map<string, number> {
  const total = new Map<string, number>();
  const user = new Map<string, number>();
  for (const fw of frozenWork) {
    total.set(fw.invoiceId, (total.get(fw.invoiceId) ?? 0) + fw.workOre);
    if (fw.userId === userId) user.set(fw.invoiceId, (user.get(fw.invoiceId) ?? 0) + fw.workOre);
  }
  const ratio = new Map<string, number>();
  for (const [inv, t] of total) if (t > 0) ratio.set(inv, (user.get(inv) ?? 0) / t);
  return ratio;
}

/** invoiceId → senaste avskrivnings-tidpunkt ur WriteOff-posterna (ADR 0007). */
function writtenOffDates(writeOffs: Array<{ invoiceId?: string; writtenOffAt?: unknown }>): Map<string, Date> {
  const m = new Map<string, Date>();
  for (const w of writeOffs) {
    if (!w.invoiceId) continue;
    const d = coerceDate(w.writtenOffAt);
    const cur = m.get(w.invoiceId);
    if (!cur || d.getTime() > cur.getTime()) m.set(w.invoiceId, d);
  }
  return m;
}

function toInvoiceInputs(invoices: RawInvoice[], writtenOff: Map<string, Date>): BilledInvoiceInput[] {
  return invoices.map((i) => ({
    id: i.id,
    amountOre: i.amount,
    invoiceDate: coerceDate(i.invoiceDate),
    status: i.status,
    // Avskrivnings-tidpunkt från WriteOff-posten (ADR 0007); fallback till
    // updatedAt-heuristiken (#90) för ev. BAD_DEBT-faktura utan post.
    writtenOffAt: writtenOff.get(i.id) ?? (i.status === "BAD_DEBT" ? coerceDate(i.updatedAt) : null),
  }));
}

/** Föregående kalendermånad relativt periodstarten (UTC). */
function previousCalendarMonth(periodStart: Date): { from: Date; to: Date } {
  const y = periodStart.getUTCFullYear();
  const m = periodStart.getUTCMonth();
  return {
    from: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)), // dag 0 i denna månad = sista dagen i föregående
  };
}

// ─── Router ──────────────────────────────────────────────────────────

/** Per-faktura-rader för Kundfordrings-tabellen (slår ihop "Fakturerat"-tabellen). */
interface ArRowMeta { invoiceDate: string; matterId: string; matterNumber: string; title: string }
const EMPTY_AR_META: ArRowMeta = { invoiceDate: "", matterId: "", matterNumber: "", title: "" };

/** Förresolva faktura-metadata (datum + ärende) per id — håller rad-mappningen trivial. */
function arMetaById(invoices: Record<string, unknown>[]): Map<string, ArRowMeta> {
  const m = new Map<string, ArRowMeta>();
  for (const inv of invoices as Array<{ id?: string; invoiceDate?: unknown; matter?: { id?: string; matterNumber?: string; title?: string } | null }>) {
    const mt = inv.matter ?? {};
    m.set(String(inv.id ?? ""), {
      invoiceDate: coerceDate(inv.invoiceDate).toISOString(),
      matterId: mt.id ?? "",
      matterNumber: mt.matterNumber ?? "",
      title: mt.title ?? "",
    });
  }
  return m;
}

function arRowsFrom(scoped: { invoices: Record<string, unknown>[]; payments: Record<string, unknown>[]; writeOffs: Record<string, unknown>[] }) {
  const meta = arMetaById(scoped.invoices);
  return perInvoiceRows(scoped.invoices, scoped.payments, scoped.writeOffs).map((r) => {
    const m = meta.get(r.invoiceId) ?? EMPTY_AR_META;
    return { id: r.invoiceId, ...m, fakturerat: r.amount, inbetalt: r.paid, avskrivet: r.writtenOff, utestaende: r.outstanding };
  });
}

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

  /**
   * "Fakturerat per advokat och period" (#90). För vald advokat + period:
   * fakturor som gått ut (attribuerade proportionellt mot advokatens andel
   * av frozen arbetsvärde i fakturan), deras summa, och netto efter avdrag
   * för fakturor avskrivna i FÖREGÅENDE kalendermånad.
   */
  billed: protectedProcedure
    .input(z.object({
      from: z.string(),
      to: z.string(),
      userId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      toDate.setUTCHours(23, 59, 59, 999);
      const prevPeriod = previousCalendarMonth(fromDate);
      const orgScope = { matter: { organizationId: ctx.user.organizationId } };

      const [user, invoices, billingRuns, timeEntries, writeOffs] = await Promise.all([
        ctx.dataStore.users.findFirst({
          where: { id: input.userId, organizationId: ctx.user.organizationId },
          select: { id: true, name: true },
        }),
        ctx.dataStore.invoices.findMany({
          where: orgScope,
          select: {
            id: true, amount: true, status: true, invoiceDate: true, updatedAt: true,
            matter: { select: { matterNumber: true, title: true } },
          },
        }),
        ctx.dataStore.billingRuns.findMany({ where: orgScope, select: { id: true, invoiceId: true } }),
        ctx.dataStore.timeEntries.findMany({
          where: { ...orgScope, billable: true },
          select: { userId: true, minutes: true, hourlyRate: true, invoiceId: true, frozenByBillingRunId: true },
        }),
        ctx.dataStore.writeOffs.findMany({ select: { invoiceId: true, writtenOffAt: true } }),
      ]);

      if (!user) return null;

      const runToInvoice = new Map<string, string>();
      for (const r of billingRuns) if (r.invoiceId) runToInvoice.set(r.id, r.invoiceId);

      const result = billedPerLawyer({
        userId: input.userId,
        invoices: toInvoiceInputs(invoices as RawInvoice[], writtenOffDates(writeOffs as Array<{ invoiceId?: string; writtenOffAt?: unknown }>)),
        frozenWork: buildFrozenWork(timeEntries as RawTimeEntry[], runToInvoice),
        period: { from: fromDate, to: toDate },
        prevPeriod,
      });

      const matterByInvoice = new Map(
        (invoices as Array<{ id: string; matter?: { matterNumber?: string; title?: string } | null }>)
          .map((i) => [i.id, i.matter]),
      );
      const rows = result.invoices.map((r) => ({
        id: r.id,
        invoiceDate: r.invoiceDate.toISOString(),
        amountOre: r.amountOre,
        shareOre: r.shareOre,
        matterNumber: matterByInvoice.get(r.id)?.matterNumber ?? "",
        title: matterByInvoice.get(r.id)?.title ?? "",
      }));

      return {
        user: { id: user.id, name: user.name },
        period: { from: input.from, to: input.to },
        prevPeriod: {
          from: prevPeriod.from.toISOString().slice(0, 10),
          to: prevPeriod.to.toISOString().slice(0, 10),
        },
        invoices: rows,
        billedOre: result.billedOre,
        writeOffOre: result.writeOffOre,
        netOre: result.netOre,
      };
    }),

  /**
   * Kundfordrings-sammanställning (ADR 0007), LIVSTID: brygga + åldersanalys.
   * Bygger på WriteOff-posterna (#136–139) → konstaterad kundförlust är en
   * daterad sanning, inte en härledd updatedAt-gissning.
   */
  arSummary: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string(), userId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      toDate.setUTCHours(23, 59, 59, 999);
      const orgScope = { matter: { organizationId: ctx.user.organizationId } };
      const invoices = await ctx.dataStore.invoices.findMany({
        where: orgScope,
        select: {
          id: true, amount: true, status: true, invoiceType: true, creditedInvoiceId: true,
          invoiceDate: true, dueDate: true, dueAt: true,
          matter: { select: { id: true, matterNumber: true, title: true } },
        },
      });
      const ids = (invoices as Array<{ id: string }>).map((i) => i.id);
      const [payments, writeOffs] = await Promise.all([
        ctx.dataStore.payments.findMany({ where: { invoiceId: { in: ids } }, select: { invoiceId: true, amount: true } }),
        ctx.dataStore.writeOffs.findMany({ where: { invoiceId: { in: ids } }, select: { invoiceId: true, amount: true } }),
      ]);

      // Scopa till fakturor utställda i perioden (ADR 0007 #4, uppdaterat) så
      // panelen följer rapport-filtret som de övriga rapporterna.
      let scoped = scopeArToPeriod(
        invoices as Record<string, unknown>[],
        payments as Record<string, unknown>[],
        writeOffs as Record<string, unknown>[],
        { from: fromDate, to: toDate },
      );

      // Filtrera på vald advokat: attribuera proportionellt mot advokatens
      // frysta arbetsvärde per faktura (samma modell som "Fakturerat per advokat").
      if (input.userId) {
        const [billingRuns, timeEntries] = await Promise.all([
          ctx.dataStore.billingRuns.findMany({ where: orgScope, select: { id: true, invoiceId: true } }),
          ctx.dataStore.timeEntries.findMany({
            where: { ...orgScope, billable: true },
            select: { userId: true, minutes: true, hourlyRate: true, invoiceId: true, frozenByBillingRunId: true },
          }),
        ]);
        const runToInvoice = new Map<string, string>();
        for (const r of billingRuns as Array<{ id: string; invoiceId?: string }>) {
          if (r.invoiceId) runToInvoice.set(r.id, r.invoiceId);
        }
        const ratios = lawyerShareRatios(buildFrozenWork(timeEntries as RawTimeEntry[], runToInvoice), input.userId);
        scoped = attributeArToLawyer(scoped.invoices, scoped.payments, scoped.writeOffs, ratios);
      }

      const now = new Date();
      return {
        bridge: computeArBridge(scoped.invoices, scoped.payments, scoped.writeOffs, now),
        aging: computeAging(scoped.invoices, scoped.payments, scoped.writeOffs, now),
        rows: arRowsFrom(scoped),
      };
    }),
});
