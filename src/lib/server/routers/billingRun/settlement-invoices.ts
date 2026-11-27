/**
 * Slutregleringens bokning i billingRun-routern (#1768, steg 3): byråns förlust,
 * betalar-körningen, klientfakturan, nedbrytningen och länkningen av arbete och
 * aconto-avdrag till fakturorna. Flyttade oförändrade ur `billingRun.ts`.
 *
 * Importerar aldrig `./settlement` (ingen cykel).
 */
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { deductAcconto } from "@/lib/shared/billing/acconto-vat";
import { vatOreOf, type UnfrozenWork } from "@/lib/shared/billing/billing-work-value";
import { arvodeInclVatOre } from "@/lib/shared/billing/invoice-calc";
import { settlementAmounts, type SettlementAllocation } from "@/lib/shared/billing/settlement-allocation";
import {
  buildClientArvodeLines, buildCreditView, creditPayload, radgivningOre,
  type SettlementBreakdown, type SettlementView,
} from "@/lib/shared/billing/settlement-view";
import { CURRENT_ROUNDING } from "@/lib/shared/billing/whole-kronor";
import { formatKr } from "@/lib/shared/kr-format";
import type { BillingRun, Invoice } from "@/lib/shared/schemas/billing";
import type { BillingRunRecipient, PaymentMethod } from "@/lib/shared/schemas/enums";
import { asId, type InvoiceId, type MatterId, type OrganizationId, type UserId } from "@/lib/shared/schemas/ids";
import { emit, type EmitCtx } from "../../events/emit";
import { callTime, newRowId, type QueuedCallScope } from "../../queued-call";
import type { BillingRunListRow } from "../../repositories/billing-run-repository";
import type { Repositories } from "../../repositories/repositories";
import { accontoDeductionsByInvoiceIds, freezeWork, invoiceNumbering } from "./shared";

/** Bokar byråns prutningsförlust (rättshjälp) som icke-debiterbart PRUTNING-utlägg. */
export async function bookFirmLoss(repos: Repositories, a: { userId: UserId; matterId: MatterId; firmLossOre: number; scope: QueuedCallScope }): Promise<void> {
  const { userId, matterId, firmLossOre } = a;
  if (firmLossOre <= 0) return;
  await repos.expenses.create({
    id: asId<"ExpenseId">(newRowId(a.scope, "firmLoss")),
    matterId, userId, date: callTime(a.scope),
    amount: -firmLossOre, description: "Prutning — byrån bär (rättshjälp)",
    billable: false, vatRate: 0, vatIncluded: false, kind: "PRUTNING",
  });
}

interface PayerRunInput {
  matterId: MatterId; payerRecipient: BillingRunRecipient; payerInvoiceId: InvoiceId;
  payerGross: number; notes: string | null | undefined; krRun: BillingRunListRow | undefined;
  scope: QueuedCallScope;
}

/** Betalar-körningen vid slutreglering (#828): ALLTID en egen FINAL — kostnads-
 *  räkningen konsumeras inte längre in i fakturan (KR:n förblir distinkt med sitt
 *  dokument/beslut). Finns ingen KR (rättsskydd) fryses det ofrysta arbetet nu;
 *  finns en KR är arbetet redan fryst mot den. */
export async function bookPayerRun(repos: Repositories, p: PayerRunInput): Promise<BillingRun> {
  const at = callTime(p.scope);
  const run = await repos.billingRuns.create({
    id: asId<"BillingRunId">(newRowId(p.scope, "payerRun")),
    matterId: p.matterId, type: "FINAL", recipient: p.payerRecipient, status: "SENT",
    workValueOreAtRun: p.payerGross, proposedAmountOre: p.payerGross, amountOre: p.payerGross,
    invoiceId: p.payerInvoiceId, deductedBillingRunIds: [], periodTo: at, notes: p.notes,
  });
  if (!p.krRun) await freezeWork(repos, p.matterId, run.id, at);
  return run;
}

/**
 * Länka slutregleringens arbete + aconto-avdrag till fakturorna (#856): arbetet
 * (arvode+utlägg) bärs av betalar-fakturan, aconto-avdragen registreras på
 * klientfakturan → fakturaspecifikationen kan hämtas per faktura och slutfaktura-
 * vyn slutar visa 0.00. Utbrutet så settleCoverage-handlern håller sig ≤8.
 */
export async function linkSettlementInvoices(repos: Repositories, a: {
  work: UnfrozenWork; payerInvoiceId: InvoiceId; clientInvoiceId: InvoiceId; deductedRuns: ReadonlyArray<{ invoiceId?: InvoiceId | null | undefined }>;
  scope: QueuedCallScope;
}): Promise<void> {
  await repos.timeEntries.flagBilled(a.work.timeEntries.filter((t) => t.billable).map((t) => t.id), a.payerInvoiceId);
  await repos.expenses.flagBilled(a.work.expenses.filter((e) => e.billable).map((e) => e.id), a.payerInvoiceId);
  for (const r of a.deductedRuns) {
    if (!r.invoiceId) continue;
    const id = asId<"AccontoDeductionId">(newRowId(a.scope, `accontoDeduction:${r.invoiceId}`));
    await repos.accontoDeductions.create({ id, finalInvoiceId: a.clientInvoiceId, accontoInvoiceId: r.invoiceId });
  }
}


export async function buildSettlementBreakdown(repos: Repositories, orgId: OrganizationId, a: {
  clientShareBips: number; totalArvodeNet: number; allocation: SettlementAllocation; work: UnfrozenWork;
  clientPayable: number; radgivningInvoiced: boolean; rateOre: number; settleDate: Date | string;
  deductedRuns: ReadonlyArray<{ invoiceId?: InvoiceId | null | undefined }>;
}): Promise<SettlementBreakdown> {
  // Rådgivningstimmen ingår ALDRIG i domstolens arvode (#860/#1205) — den är en
  // låst, redan fakturerad post och finns inte i `work`; den omnämns bara.
  // Delbeloppen läses ur fakturornas egna rader (#1438), så vyn och fakturan är samma tal.
  const deductedAccontos = await accontoDeductionsByInvoiceIds(repos, orgId, a.deductedRuns.map((r) => r.invoiceId));
  const { allocation } = a;
  return {
    clientShareBips: a.clientShareBips,
    arvodeBaseNetOre: a.totalArvodeNet,
    baseArvodeGrossOre: arvodeInclVatOre(a.totalArvodeNet),
    expensesBaseNetOre: allocation.expensesBaseNetOre,
    expenseLossNetOre: allocation.expenseLossNetOre,
    ...settlementAmounts(allocation),
    firmLossNetOre: allocation.arvodeLossNetOre,
    prutningGrossOre: arvodeInclVatOre(allocation.arvodeLossNetOre),
    ...radgivningOre(a.radgivningInvoiced, a.rateOre),
    payerPayableOre: allocation.payerGrossOre,
    clientPayableOre: a.clientPayable,
    clientArvodeLines: buildClientArvodeLines(a.work, a.totalArvodeNet, a.settleDate),
    deductedAccontos,
    ...(allocation.split.clientParts ? { clientParts: allocation.split.clientParts } : {}),
  };
}


export async function createClientSettlementInvoice(repos: Repositories, ctx: EmitCtx & QueuedCallScope, orgId: OrganizationId, a: {
  matterId: MatterId; clientGrossOre: number; deductionOre: number;
  clientLines: VatBreakdownLine[]; clientView: SettlementView; method: PaymentMethod; invoiceDate: Date; notes: string | null | undefined;
}): Promise<{ invoice: Invoice; creditInvoice: Invoice | null }> {
  const clientNet = a.clientGrossOre - a.deductionOre; // kan vara negativt (överbetald)
  const isCredit = clientNet < 0;
  const feeTerm = a.method === "RATTSHJALP" ? "rättshjälpsavgift" : "självrisk";
  const base = {
    id: asId<"InvoiceId">(newRowId(ctx, "clientInvoice")),
    matterId: a.matterId, amount: clientNet, ...(await invoiceNumbering(repos, orgId, "KLIENT", a.invoiceDate)), invoiceDate: a.invoiceDate,
    amountRounding: CURRENT_ROUNDING,
  };
  // #968 (modell A): acontona har redan bokfört sin intäkt och sin moms, så
  // slutfakturan bär bara det som ÅTERSTÅR — annars bokförs acontot två gånger.
  const rest = deductAcconto(a.clientLines, a.deductionOre);
  const payload = isCredit
    ? {
        ...base,
        // Krediteringen vänder exakt det som blev för mycket bokfört: acontonas
        // intäkt och moms minus fakturans faktiska (#968). Förr räknades 25 % på
        // mellanskillnaden rakt av, vilket blir fel så snart fakturan bär utlägg
        // med andra satser — acontot är alltid 25 %.
        ...creditPayload(a.clientLines, a.deductionOre),
        // #895: full spec (tidsspec + rättshjälpsavgift + avdragna aconton) → kredit-netto.
        settlementBreakdown: buildCreditView(a.clientView, clientNet),
        invoiceType: "CREDIT" as const, status: "SENT" as const,
        notes: `Rättshjälps-överfakturering: betalda aconton (${formatKr(a.deductionOre)}) översteg slutlig ${feeTerm} — mellanskillnaden krediteras klienten.`,
      }
    : {
        ...base, vatOre: vatOreOf(rest.lines), vatBreakdown: rest.lines,
        settlementBreakdown: a.clientView, invoiceType: "FINAL" as const, status: "DRAFT" as const, notes: a.notes,
      };
  const invoice = await repos.invoices.create(payload);
  await emit.invoiceCreated(ctx, invoice);
  return { invoice, creditInvoice: isCredit ? invoice : null };
}
