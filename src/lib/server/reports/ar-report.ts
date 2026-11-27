/**
 * Kundfordrings-sammanställningen (`reports.arSummary`, ADR 0007), utbruten
 * ur rapportroutern (#2176): brygga + åldersanalys + en rad per faktura.
 * Bygger på WriteOff-posterna (#136–139) → konstaterad kundförlust är en
 * daterad sanning, inte en härledd updatedAt-gissning.
 */
import {
  attributeArToLawyer, computeAging, computeArBridge, perInvoiceRows, scopeArToPeriod,
  type AgingBucket, type ArBridge,
} from "@/lib/shared/ar-summary";
import { asId, type MatterId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import { stockholmPeriod } from "@/lib/shared/stockholm-time";
import type { Repositories } from "../repositories/repositories";
import { buildFrozenWork, coerceDate, lawyerShareRatios, runToInvoiceMap } from "./billed-work";

/** Per-faktura-rader för Kundfordrings-tabellen (slår ihop "Fakturerat"-tabellen). */
interface ArRowMeta { invoiceNumber: string; invoiceDate: string; matterId: MatterId; matterNumber: string; title: string }
const EMPTY_AR_META: ArRowMeta = { invoiceNumber: "", invoiceDate: "", matterId: asId<"MatterId">(""), matterNumber: "", title: "" };

/** En faktura i Kundfordrings-tabellen. Alla belopp i öre. */
interface ArRow extends ArRowMeta {
  id: string; fakturerat: number; inbetalt: number; avskrivet: number; utestaende: number;
}

/** Förresolva faktura-metadata (nummer + datum + ärende) per id — håller rad-mappningen trivial. */
function arMetaById(invoices: Record<string, unknown>[]): Map<string, ArRowMeta> {
  const m = new Map<string, ArRowMeta>();
  for (const inv of invoices as Array<{ id?: string; invoiceNumber?: string | null; invoiceDate?: unknown; matter?: { id?: string; matterNumber?: string; title?: string } | null }>) {
    const mt = inv.matter ?? {};
    m.set(inv.id ?? "", {
      invoiceNumber: inv.invoiceNumber ?? "",
      invoiceDate: coerceDate(inv.invoiceDate).toISOString(),
      matterId: asId<"MatterId">(mt.id ?? ""),
      matterNumber: mt.matterNumber ?? "",
      title: mt.title ?? "",
    });
  }
  return m;
}

function arRowsFrom(scoped: { invoices: Record<string, unknown>[]; payments: Record<string, unknown>[]; writeOffs: Record<string, unknown>[] }): ArRow[] {
  const meta = arMetaById(scoped.invoices);
  return perInvoiceRows(scoped.invoices, scoped.payments, scoped.writeOffs).map((r) => {
    const m = meta.get(r.invoiceId) ?? EMPTY_AR_META;
    return { id: r.invoiceId, ...m, fakturerat: r.amount, inbetalt: r.paid, avskrivet: r.writtenOff, utestaende: r.outstanding };
  });
}

/** Period (svenska kalenderdagar) och, valfritt, en advokat att attribuera mot. */
export interface ArReportInput { from: string; to: string; userId?: UserId | undefined }

/** Sammanställningen: brygga, åldersanalys och fakturaraderna. */
export interface ArReport { bridge: ArBridge; aging: AgingBucket[]; rows: ArRow[] }

type ArRepos = Pick<Repositories, "invoices" | "payments" | "writeOffs" | "billingRuns" | "timeEntries">;

/**
 * Fordringsläget för fakturor utställda i perioden. Med `userId` attribueras
 * det proportionellt mot advokatens frysta arbetsvärde per faktura (samma
 * modell som "Fakturerat per advokat").
 */
export async function loadArReport(repos: ArRepos, org: OrganizationId, input: ArReportInput): Promise<ArReport> {
  const { from: fromDate, to: toDate } = stockholmPeriod(input.from, input.to);
  const invoices = await repos.invoices.listForOrg(asId<"OrganizationId">(org));
  const ids = invoices.map((i) => i.id);
  const [payments, writeOffs] = await Promise.all([
    repos.payments.listByInvoiceIds(ids),
    repos.writeOffs.listByInvoiceIds(ids),
  ]);

  // Scopa till fakturor utställda i perioden (ADR 0007 #4, uppdaterat) så
  // panelen följer rapport-filtret som de övriga rapporterna.
  let scoped = scopeArToPeriod(invoices, payments, writeOffs, { from: fromDate, to: toDate });

  // Filtrera på vald advokat: attribuera proportionellt mot advokatens
  // frysta arbetsvärde per faktura (samma modell som "Fakturerat per advokat").
  if (input.userId) {
    const [billingRuns, timeEntries] = await Promise.all([
      repos.billingRuns.listForOrg(org),
      repos.timeEntries.listBillableForOrg(org),
    ]);
    const ratios = lawyerShareRatios(buildFrozenWork(timeEntries, runToInvoiceMap(billingRuns)), input.userId);
    scoped = attributeArToLawyer(scoped.invoices, scoped.payments, scoped.writeOffs, ratios);
  }

  const now = new Date();
  return {
    bridge: computeArBridge(scoped.invoices, scoped.payments, scoped.writeOffs, now),
    aging: computeAging(scoped.invoices, scoped.payments, scoped.writeOffs, now),
    rows: arRowsFrom(scoped),
  };
}
