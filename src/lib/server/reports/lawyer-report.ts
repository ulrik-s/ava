/**
 * Advokatrapporten (`reports.perLawyer`), utbruten ur rapportroutern (#2176):
 * en advokat, en period, tre rena delrapporter över redan hämtad data.
 *   1. Ärenden advokaten jobbat i under perioden
 *   2. Timdebitering per vecka
 *   3. Upparbetat, icke fakturerat (debiterbar tid och utlägg utan faktura)
 *
 * Enheter: `minutes` i heltal minuter, `hourlyRate` i öre/timme och alla
 * belopp i öre, så UI kan använda `formatCurrency()` rakt av.
 */
import { timeEntryValueOre } from "@/lib/shared/billing/whole-kronor";
import { calendarDate, isoWeek, weeksInRange } from "@/lib/shared/calendar-periods";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";
import type { InvoiceId, MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import { stockholmDay, stockholmPeriod } from "@/lib/shared/stockholm-time";
import { hasInvoice } from "@/lib/shared/time-entry-lock";
import type { Repositories } from "../repositories/repositories";
import { loadPeriodWork } from "./period-work";

/**
 * Den delmängd av matter-selecten delrapporterna läser. Kontakterna läses
 * defensivt: ett ärende utan kontakter ger ingen klient.
 */
interface ReportMatterRef {
  id: MatterId;
  matterNumber: string;
  title: string;
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: Date | null;
  contacts?: { contact?: { name: string } | null | undefined }[] | null | undefined;
}
interface ReportTimeEntry {
  date: Date; minutes: number; billable: boolean; hourlyRate: number;
  invoiceId?: InvoiceId | null | undefined; matter?: ReportMatterRef | null | undefined;
}
interface ReportExpense {
  date: Date; amount: number; billable: boolean;
  invoiceId?: InvoiceId | null | undefined; matter?: ReportMatterRef | null | undefined;
}

/** Ett ärende i advokatrapporten. Alla belopp i öre. */
export interface MatterAgg {
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

/** En vecka i timdebiteringen. */
interface WeeklyRow {
  isoYear: number; week: number; start: string; end: string;
  totalMinutes: number; billableMinutes: number; workValueOre: number;
}

/** Periodtotalerna över advokatens ärenden. */
export interface MatterTotals { totalMinutes: number; billableMinutes: number; workValueOre: number; expenseOre: number }

function weekKey(isoYear: number, week: number): string {
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

const clientName = (m: ReportMatterRef): string | null => m.contacts?.[0]?.contact?.name ?? null;

/** Debiterbar och ännu inte knuten till en faktura. */
const isOpenBillable = (x: { billable: boolean; invoiceId?: string | null | undefined }): boolean => x.billable && !hasInvoice(x);

/** 1. Ärenden advokaten jobbat i under perioden. */
export function buildMatters(timeEntries: ReportTimeEntry[], expenses: ReportExpense[]): MatterAgg[] {
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
      agg.workValueOre += timeEntryValueOre(te.minutes, te.hourlyRate);
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
function buildWeeklyRows(timeEntries: ReportTimeEntry[], fromDay: string, toDay: string): WeeklyRow[] {
  const rows = weeksInRange(calendarDate(fromDay), calendarDate(toDay)).map((w): WeeklyRow => ({
    isoYear: w.isoYear, week: w.week,
    start: stockholmDay(w.start), end: stockholmDay(w.end), // UTC-midnatt → samma svenska dag
    totalMinutes: 0, billableMinutes: 0, workValueOre: 0,
  }));
  const grid = new Map(rows.map((row) => [weekKey(row.isoYear, row.week), row]));
  for (const te of timeEntries) {
    const { year, week } = isoWeek(calendarDate(stockholmDay(te.date)));
    const cell = grid.get(weekKey(year, week));
    if (!cell) continue;
    cell.totalMinutes += te.minutes;
    if (te.billable) {
      cell.billableMinutes += te.minutes;
      cell.workValueOre += timeEntryValueOre(te.minutes, te.hourlyRate);
    }
  }
  return rows;
}

/** 3. Upparbetat, icke fakturerat: debiterbar tid+utlägg utan invoiceId. */
export function buildUnbilled(timeEntries: ReportTimeEntry[], expenses: ReportExpense[]): { rows: UnbilledRow[]; total: number } {
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
    const ore = timeEntryValueOre(te.minutes, te.hourlyRate);
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
export function sumMatterTotals(matters: MatterAgg[]): MatterTotals {
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

/** Period (svenska kalenderdagar, `YYYY-MM-DD`) och advokat. */
export interface LawyerReportInput { from: string; to: string; userId: UserId }

/** Advokatrapporten: advokaten, perioden och de tre delrapporterna. */
export interface LawyerReport {
  user: { id: UserId; name: string; hourlyRates: HourlyRates };
  period: { from: string; to: string };
  matters: MatterAgg[];
  weeklyRows: WeeklyRow[];
  unbilled: { rows: UnbilledRow[]; total: number };
  totals: MatterTotals;
}

/** Hämta periodens arbete och bygg advokatrapporten; `null` om advokaten inte finns i byrån. */
export async function loadLawyerReport(
  repos: Pick<Repositories, "users" | "timeEntries" | "expenses">, org: OrganizationId, input: LawyerReportInput,
): Promise<LawyerReport | null> {
  const { from: fromDate, to: toDate } = stockholmPeriod(input.from, input.to);
  const [user, { timeEntries, expenses }] = await Promise.all([
    repos.users.getByIdInOrg(input.userId, org),
    loadPeriodWork(repos, org, { kind: "lawyer", userId: input.userId }, fromDate, toDate),
  ]);
  if (!user) return null;
  const matters = buildMatters(timeEntries, expenses);
  return {
    user: { id: user.id, name: user.name, hourlyRates: user.hourlyRates },
    period: { from: input.from, to: input.to },
    matters,
    weeklyRows: buildWeeklyRows(timeEntries, stockholmDay(fromDate), stockholmDay(toDate)),
    unbilled: buildUnbilled(timeEntries, expenses),
    totals: sumMatterTotals(matters),
  };
}
