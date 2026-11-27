/**
 * Byråöversikten (`reports.firmOverview`, #1016), utbruten ur rapportroutern
 * (#2176): en rad per jurist + byråtotaler + fordringsläge, i ETT anrop.
 * Komponerad ur samma rena delrapporter som advokatrapporten och "Fakturerat
 * per advokat"; org-datat hämtas en gång och delas mellan raderna.
 */
import { computeArBridge, scopeArToPeriod, type ArBridge } from "@/lib/shared/ar-summary";
import { billedPerLawyer, type BilledInvoiceInput, type FrozenWorkInput } from "@/lib/shared/billed-per-lawyer";
import { asId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import { stockholmPeriod } from "@/lib/shared/stockholm-time";
import type { Repositories } from "../repositories/repositories";
import {
  buildFrozenWork, previousCalendarMonth, runToInvoiceMap, toInvoiceInputs, writtenOffDates,
} from "./billed-work";
import { buildMatters, buildUnbilled, sumMatterTotals } from "./lawyer-report";

/** En jurists rad i byråöversikten. Alla kronbelopp i öre. */
interface FirmLawyerRow {
  userId: string;
  name: string;
  title: string | null;
  totalMinutes: number;
  billableMinutes: number;
  workValueOre: number;
  expenseOre: number;
  /** Upparbetat, ännu inte fakturerat (debiterbar tid + utlägg utan faktura). */
  unbilledOre: number;
  /** Fakturerat i perioden, attribuerat mot juristens andel av fryst arbete (#90). */
  billedOre: number;
  writeOffOre: number;
  netOre: number;
}

/** Org-datat som hämtas EN gång och delas mellan jurist-raderna. */
interface FirmShared {
  invoiceInputs: BilledInvoiceInput[];
  frozenWork: FrozenWorkInput[];
  period: { from: Date; to: Date };
  prevPeriod: { from: Date; to: Date };
}

/** En jurists rad: periodens arbete (samma delrapporter som perLawyer) + fakturerat. */
async function firmLawyerRow(
  repos: Pick<Repositories, "timeEntries" | "expenses">,
  org: OrganizationId,
  user: { id: UserId; name: string; title?: string | null | undefined },
  shared: FirmShared,
): Promise<FirmLawyerRow> {
  const [timeEntries, expenses] = await Promise.all([
    repos.timeEntries.listForLawyerInPeriod(org, user.id, shared.period.from, shared.period.to),
    repos.expenses.listForLawyerInPeriod(org, user.id, shared.period.from, shared.period.to),
  ]);
  const totals = sumMatterTotals(buildMatters(timeEntries, expenses));
  const billed = billedPerLawyer({
    userId: user.id,
    invoices: shared.invoiceInputs,
    frozenWork: shared.frozenWork,
    period: shared.period,
    prevPeriod: shared.prevPeriod,
  });
  return {
    userId: String(user.id),
    name: user.name,
    title: user.title ?? null,
    ...totals,
    unbilledOre: buildUnbilled(timeEntries, expenses).total,
    billedOre: billed.billedOre,
    writeOffOre: billed.writeOffOre,
    netOre: billed.netOre,
  };
}

type FirmTotals = Omit<FirmLawyerRow, "userId" | "name" | "title">;

/** Byråtotalerna = summan av raderna, fält för fält. */
function firmTotals(rows: readonly FirmLawyerRow[]): FirmTotals {
  const zero: FirmTotals = {
    totalMinutes: 0, billableMinutes: 0, workValueOre: 0, expenseOre: 0,
    unbilledOre: 0, billedOre: 0, writeOffOre: 0, netOre: 0,
  };
  return rows.reduce<FirmTotals>((acc, r) => ({
    totalMinutes: acc.totalMinutes + r.totalMinutes,
    billableMinutes: acc.billableMinutes + r.billableMinutes,
    workValueOre: acc.workValueOre + r.workValueOre,
    expenseOre: acc.expenseOre + r.expenseOre,
    unbilledOre: acc.unbilledOre + r.unbilledOre,
    billedOre: acc.billedOre + r.billedOre,
    writeOffOre: acc.writeOffOre + r.writeOffOre,
    netOre: acc.netOre + r.netOre,
  }), zero);
}

/** Byråöversikten: juristraderna, byråtotalerna och fordringsbryggan för perioden. */
export interface FirmOverview {
  period: { from: string; to: string };
  lawyers: FirmLawyerRow[];
  totals: FirmTotals;
  ar: ArBridge;
}

type FirmRepos = Pick<
  Repositories,
  "users" | "invoices" | "billingRuns" | "timeEntries" | "expenses" | "payments" | "writeOffs"
>;

/** Hämta org-datat en gång och bygg byråöversikten för perioden (svenska kalenderdagar). */
export async function loadFirmOverview(
  repos: FirmRepos, org: OrganizationId, input: { from: string; to: string },
): Promise<FirmOverview> {
  const { from: fromDate, to: toDate } = stockholmPeriod(input.from, input.to);

  const [users, invoices, billingRuns, frozenTime] = await Promise.all([
    repos.users.listByOrg(asId<"OrganizationId">(org)),
    repos.invoices.listForOrg(asId<"OrganizationId">(org)),
    repos.billingRuns.listForOrg(org),
    repos.timeEntries.listBillableForOrg(org),
  ]);
  const ids = invoices.map((i) => i.id);
  const [payments, writeOffs] = await Promise.all([
    repos.payments.listByInvoiceIds(ids),
    repos.writeOffs.listByInvoiceIds(ids),
  ]);

  const shared: FirmShared = {
    invoiceInputs: toInvoiceInputs(invoices, writtenOffDates(writeOffs)),
    frozenWork: buildFrozenWork(frozenTime, runToInvoiceMap(billingRuns)),
    period: { from: fromDate, to: toDate },
    prevPeriod: previousCalendarMonth(fromDate),
  };

  const lawyers = await Promise.all(users.map((u) => firmLawyerRow(repos, org, u, shared)));
  const scoped = scopeArToPeriod(invoices, payments, writeOffs, { from: fromDate, to: toDate });
  return {
    period: { from: input.from, to: input.to },
    lawyers,
    totals: firmTotals(lawyers),
    ar: computeArBridge(scoped.invoices, scoped.payments, scoped.writeOffs, new Date()),
  };
}
