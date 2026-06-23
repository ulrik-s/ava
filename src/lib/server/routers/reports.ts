import { z } from "zod";
import { computeArBridge, computeAging, scopeArToPeriod, attributeArToLawyer, perInvoiceRows } from "@/lib/shared/ar-summary";
import {
  billedPerLawyer,
  type BilledInvoiceInput,
  type FrozenWorkInput,
} from "@/lib/shared/billed-per-lawyer";
import type { InvoiceStatus, PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId, userIdSchema, type BillingRunId, type InvoiceId, type MatterId, type UserId } from "@/lib/shared/schemas/ids";
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

// ─── Hjälpare för "Fakturerat per advokat" (#90) ─────────────────────

/** Demo-projektionen lagrar datum som ISO-strängar → coerca till Date. */
function coerceDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}

interface RawTimeEntry {
  userId: UserId; minutes: number; hourlyRate: number;
  invoiceId: InvoiceId | null | undefined; frozenByBillingRunId: BillingRunId | null | undefined;
}
interface RawInvoice { id: string; amount: number; status: InvoiceStatus; invoiceDate: unknown; updatedAt: unknown }

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
    out.push({
      invoiceId: asId<"InvoiceId">(invoiceId),
      userId: asId<"UserId">(te.userId),
      workOre: Math.round((te.minutes / 60) * te.hourlyRate),
    });
  }
  return out;
}

/** invoiceId → advokatens andel (userWork/totalWork ∈ [0,1]) ur frysta tidsposter. */
function lawyerShareRatios(frozenWork: FrozenWorkInput[], userId: UserId): Map<string, number> {
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
    id: asId<"InvoiceId">(i.id),
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
interface ArRowMeta { invoiceNumber: string; invoiceDate: string; matterId: MatterId; matterNumber: string; title: string }
const EMPTY_AR_META: ArRowMeta = { invoiceNumber: "", invoiceDate: "", matterId: asId<"MatterId">(""), matterNumber: "", title: "" };

/** Förresolva faktura-metadata (nummer + datum + ärende) per id — håller rad-mappningen trivial. */
function arMetaById(invoices: Record<string, unknown>[]): Map<string, ArRowMeta> {
  const m = new Map<string, ArRowMeta>();
  for (const inv of invoices as Array<{ id?: string; invoiceNumber?: string | null; invoiceDate?: unknown; matter?: { id?: string; matterNumber?: string; title?: string } | null }>) {
    const mt = inv.matter ?? {};
    m.set(String(inv.id ?? ""), {
      invoiceNumber: inv.invoiceNumber ?? "",
      invoiceDate: coerceDate(inv.invoiceDate).toISOString(),
      matterId: asId<"MatterId">(mt.id ?? ""),
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

// ─── perLawyer-delrapporter (#6: utbrutna ur query-arrowen → testbara) ──

/** Den delmängd av matter-selecten delrapporterna läser. */
interface ReportMatterRef {
  id: MatterId;
  matterNumber: string;
  title: string;
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: Date | null;
  contacts: { contact: { name: string } }[];
}
interface ReportTimeEntry {
  date: Date; minutes: number; billable: boolean; hourlyRate: number;
  invoiceId?: InvoiceId | null | undefined; matter?: ReportMatterRef | null | undefined;
}
interface ReportExpense {
  date: Date; amount: number; billable: boolean;
  invoiceId?: InvoiceId | null | undefined; matter?: ReportMatterRef | null | undefined;
}

interface MatterAgg {
  matterId: MatterId; matterNumber: string; title: string; client: string | null;
  paymentMethod: PaymentMethod; paymentMethodNote: string | null; paymentMethodDecidedAt: Date | null;
  totalMinutes: number; billableMinutes: number;
  workValueOre: number; // tid × timpris (öre)
  expenseOre: number;   // utlägg totalt (öre, bara billable)
}
interface UnbilledRow {
  matterId: MatterId; matterNumber: string; title: string; client: string | null;
  paymentMethod: PaymentMethod; timeOre: number; expenseOre: number; total: number;
}

/** hourlyRate ÄR REDAN ÖRE (öre/h) → (min/60) × öre/h = öre. */
function workValueOre(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate);
}

const clientName = (m: ReportMatterRef): string | null => m.contacts?.[0]?.contact?.name ?? null;

/** Debiterbar och ännu inte knuten till en faktura. */
const isOpenBillable = (x: { billable: boolean; invoiceId?: string | null | undefined }): boolean =>
  x.billable && !x.invoiceId;

/** 1. Ärenden advokaten jobbat i under perioden. */
function buildMatters(timeEntries: ReportTimeEntry[], expenses: ReportExpense[]): MatterAgg[] {
  const map = new Map<string, MatterAgg>();
  const ensure = (m: ReportMatterRef): MatterAgg => {
    const existing = map.get(m.id);
    if (existing) return existing;
    const agg: MatterAgg = {
      matterId: m.id, matterNumber: m.matterNumber, title: m.title, client: clientName(m),
      paymentMethod: m.paymentMethod, paymentMethodNote: m.paymentMethodNote,
      paymentMethodDecidedAt: m.paymentMethodDecidedAt,
      totalMinutes: 0, billableMinutes: 0, workValueOre: 0, expenseOre: 0,
    };
    map.set(m.id, agg);
    return agg;
  };
  for (const te of timeEntries) {
    if (!te.matter) continue;
    const agg = ensure(te.matter);
    agg.totalMinutes += te.minutes;
    if (te.billable) {
      agg.billableMinutes += te.minutes;
      agg.workValueOre += workValueOre(te.minutes, te.hourlyRate);
    }
  }
  for (const ex of expenses) {
    if (!ex.matter) continue;
    const agg = ensure(ex.matter);
    if (ex.billable) agg.expenseOre += ex.amount;
  }
  return Array.from(map.values()).sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv"));
}

/** 2. Timdebitering per vecka (alla veckor i perioden, även tomma). */
function buildWeeklyRows(timeEntries: ReportTimeEntry[], fromDate: Date, toDate: Date) {
  const weeks = weeksInRange(fromDate, toDate);
  const grid = new Map<string, { totalMinutes: number; billableMinutes: number; workValueOre: number }>();
  for (const w of weeks) grid.set(weekKey(w.isoYear, w.week), { totalMinutes: 0, billableMinutes: 0, workValueOre: 0 });
  for (const te of timeEntries) {
    const { year, week } = isoWeek(te.date);
    const cell = grid.get(weekKey(year, week));
    if (!cell) continue;
    cell.totalMinutes += te.minutes;
    if (te.billable) {
      cell.billableMinutes += te.minutes;
      cell.workValueOre += workValueOre(te.minutes, te.hourlyRate);
    }
  }
  return weeks.map((w) => {
    const cell = grid.get(weekKey(w.isoYear, w.week))!;
    return {
      isoYear: w.isoYear, week: w.week,
      start: w.start.toISOString().slice(0, 10),
      end: w.end.toISOString().slice(0, 10),
      ...cell,
    };
  });
}

/** 3. Upparbetat, icke fakturerat: debiterbar tid+utlägg utan invoiceId. */
function buildUnbilled(timeEntries: ReportTimeEntry[], expenses: ReportExpense[]): { rows: UnbilledRow[]; total: number } {
  const map = new Map<string, UnbilledRow>();
  const ensure = (m: ReportMatterRef): UnbilledRow => {
    const existing = map.get(m.id);
    if (existing) return existing;
    const row: UnbilledRow = {
      matterId: m.id, matterNumber: m.matterNumber, title: m.title, client: clientName(m),
      paymentMethod: m.paymentMethod, timeOre: 0, expenseOre: 0, total: 0,
    };
    map.set(m.id, row);
    return row;
  };
  let total = 0;
  for (const te of timeEntries) {
    if (!te.matter || !isOpenBillable(te)) continue;
    const ore = workValueOre(te.minutes, te.hourlyRate);
    const row = ensure(te.matter);
    row.timeOre += ore; row.total += ore; total += ore;
  }
  for (const ex of expenses) {
    if (!ex.matter || !isOpenBillable(ex)) continue;
    const row = ensure(ex.matter);
    row.expenseOre += ex.amount; row.total += ex.amount; total += ex.amount;
  }
  const rows = Array.from(map.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => a.matterNumber.localeCompare(b.matterNumber, "sv"));
  return { rows, total };
}

/** Summera matter-aggregaten till period-totaler. */
function sumMatterTotals(matters: MatterAgg[]) {
  return matters.reduce(
    (acc, m) => ({
      totalMinutes: acc.totalMinutes + m.totalMinutes,
      billableMinutes: acc.billableMinutes + m.billableMinutes,
      workValueOre: acc.workValueOre + m.workValueOre,
      expenseOre: acc.expenseOre + m.expenseOre,
    }),
    { totalMinutes: 0, billableMinutes: 0, workValueOre: 0, expenseOre: 0 },
  );
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
      userId: userIdSchema,
    }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      toDate.setUTCHours(23, 59, 59, 999);

      const org = ctx.user.organizationId;

      // Migrerad till repository-sömmen (ADR 0020): listForLawyerInPeriod kapslar
      // in org-scoping + matter-projektionen (betalsätt + KLIENT-kontakt).
      const [user, timeEntries, expenses] = await Promise.all([
        ctx.repos.users.getByIdInOrg(input.userId, org),
        ctx.repos.timeEntries.listForLawyerInPeriod(org, input.userId, fromDate, toDate),
        ctx.repos.expenses.listForLawyerInPeriod(org, input.userId, fromDate, toDate),
      ]);

      if (!user) {
        return null;
      }

      // Tre rena delrapporter över redan-hämtad data (utbrutna till
      // modul-nivå → query-arrowen hålls kort + delrapporterna testbara).
      const matters = buildMatters(timeEntries, expenses);
      return {
        user: { id: user.id, name: user.name, hourlyRate: user.hourlyRate },
        period: { from: input.from, to: input.to },
        matters,
        weeklyRows: buildWeeklyRows(timeEntries, fromDate, toDate),
        unbilled: buildUnbilled(timeEntries, expenses),
        totals: sumMatterTotals(matters),
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
      userId: userIdSchema,
    }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      toDate.setUTCHours(23, 59, 59, 999);
      const prevPeriod = previousCalendarMonth(fromDate);
      const org = ctx.user.organizationId;

      const [user, invoices, billingRuns, timeEntries] = await Promise.all([
        ctx.repos.users.getByIdInOrg(input.userId, org),
        ctx.repos.invoices.listForOrg(asId<"OrganizationId">(org)),
        ctx.repos.billingRuns.listForOrg(org),
        ctx.repos.timeEntries.listBillableForOrg(org),
      ]);
      // Avskrivningar org-scopas via fakturornas id:n (tidigare global findMany).
      const writeOffs = await ctx.repos.writeOffs.listByInvoiceIds(
        (invoices as Array<{ id: InvoiceId }>).map((i) => i.id),
      );

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
    .input(z.object({ from: z.string(), to: z.string(), userId: userIdSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const fromDate = new Date(input.from);
      const toDate = new Date(input.to);
      toDate.setUTCHours(23, 59, 59, 999);
      const org = ctx.user.organizationId;
      const invoices = await ctx.repos.invoices.listForOrg(asId<"OrganizationId">(org));
      const ids = (invoices as Array<{ id: InvoiceId }>).map((i) => i.id);
      const [payments, writeOffs] = await Promise.all([
        ctx.repos.payments.listByInvoiceIds(ids),
        ctx.repos.writeOffs.listByInvoiceIds(ids),
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
          ctx.repos.billingRuns.listForOrg(org),
          ctx.repos.timeEntries.listBillableForOrg(org),
        ]);
        const runToInvoice = new Map<string, string>();
        for (const r of billingRuns as Array<{ id: string; invoiceId?: string | null }>) {
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
