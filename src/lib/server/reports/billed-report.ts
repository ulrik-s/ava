/**
 * "Fakturerat per advokat och period" (`reports.billed`, #90), utbrutet ur
 * rapportroutern (#2176). För vald advokat + period: fakturor som gått ut
 * (attribuerade proportionellt mot advokatens andel av frozen arbetsvärde i
 * fakturan), deras summa, och netto efter avdrag för fakturor avskrivna i
 * FÖREGÅENDE kalendermånad. Alla belopp i öre.
 */
import { billedPerLawyer } from "@/lib/shared/billed-per-lawyer";
import { asId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import { stockholmDay, stockholmPeriod } from "@/lib/shared/stockholm-time";
import type { Repositories } from "../repositories/repositories";
import {
  buildFrozenWork, previousCalendarMonth, runToInvoiceMap, toInvoiceInputs, writtenOffDates,
} from "./billed-work";

/** Period (svenska kalenderdagar, `YYYY-MM-DD`) och advokat. */
export interface BilledReportInput { from: string; to: string; userId: UserId }

/** En faktura i rapporten med advokatens andel. */
interface BilledRow {
  id: string; invoiceDate: string; amountOre: number; shareOre: number; matterNumber: string; title: string;
}

/** Rapporten: advokaten, perioden, föregående månad och fakturorna. */
export interface BilledReport {
  user: { id: UserId; name: string };
  period: { from: string; to: string };
  prevPeriod: { from: string; to: string };
  invoices: BilledRow[];
  billedOre: number;
  writeOffOre: number;
  netOre: number;
}

type BilledRepos = Pick<Repositories, "users" | "invoices" | "billingRuns" | "timeEntries" | "writeOffs">;

/** Hämta byråns fakturor och frysta arbete och bygg rapporten; `null` om advokaten inte finns i byrån. */
export async function loadBilledReport(repos: BilledRepos, org: OrganizationId, input: BilledReportInput): Promise<BilledReport | null> {
  const { from: fromDate, to: toDate } = stockholmPeriod(input.from, input.to);
  const prevPeriod = previousCalendarMonth(fromDate);

  const [user, invoices, billingRuns, timeEntries] = await Promise.all([
    repos.users.getByIdInOrg(input.userId, org),
    repos.invoices.listForOrg(asId<"OrganizationId">(org)),
    repos.billingRuns.listForOrg(org),
    repos.timeEntries.listBillableForOrg(org),
  ]);
  // Avskrivningar org-scopas via fakturornas id:n (tidigare global findMany).
  const writeOffs = await repos.writeOffs.listByInvoiceIds(invoices.map((i) => i.id));

  if (!user) return null;

  const result = billedPerLawyer({
    userId: input.userId,
    invoices: toInvoiceInputs(invoices, writtenOffDates(writeOffs)),
    frozenWork: buildFrozenWork(timeEntries, runToInvoiceMap(billingRuns)),
    period: { from: fromDate, to: toDate },
    prevPeriod,
  });

  const matterByInvoice = new Map(invoices.map((i) => [i.id, i.matter]));
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
    prevPeriod: { from: stockholmDay(prevPeriod.from), to: stockholmDay(prevPeriod.to) },
    invoices: rows,
    billedOre: result.billedOre,
    writeOffOre: result.writeOffOre,
    netOre: result.netOre,
  };
}
