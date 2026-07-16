/**
 * BillingRun-router — fakturerings-händelser separerade från Invoice.
 *
 * Skiljer fyra typer:
 *   ACCONTO         — del-faktura till klient (rättsskydd/hjälp).
 *                     Skapar Invoice direkt, fryser INTE underliggande rader.
 *   FINAL           — slutfaktura. Fryser alla unfrozen rader. Drar av
 *                     valda ACCONTO-runs.
 *   KOSTNADSRAKNING — OFFENTLIG_FÖRSVARARE. Skickas till domstol och får
 *                     status PENDING_VERDICT tills dom kommer. Vid setVerdict
 *                     transitionar vi till SENT, skapar Invoice + ev.
 *                     Expense(kind=PRUTNING).
 *   CREDIT          — kreditering (deferred — Phase 3+).
 *
 * Alla operationer är scopade till ctx.orgId via matter-joinen.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { assertBillingTransition, type BillingActionType } from "@/lib/shared/billing-flow";
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";
import { TIMKOSTNADSNORM_FTAX_ORE_PER_H, timkostnadsnormFtaxForDate, tidsspillanFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { computeCoverageSplit, partitionRattsskyddMinutes, type CoverageSplit } from "@/lib/shared/coverage-billing";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { carveEarliestMinutes } from "@/lib/shared/kostnadsrakning";
import { applyKrAction, type KostnadsrakningAction, type KostnadsrakningState, type KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { RADGIVNING_MINUTES, radgivningTextRad } from "@/lib/shared/rattshjalp";
import { settlementBreakdownSchema, type BillingRun, type Invoice } from "@/lib/shared/schemas/billing";
import { billingRunRecipientSchema, type BillingRunRecipient, type ExpenseKind, type PaymentMethod } from "@/lib/shared/schemas/enums";
import {
  matterIdSchema,
  billingRunIdSchema,
  invoiceIdSchema,
  timeEntryIdSchema,
  expenseIdSchema,
  asId,
  type BillingRunId,
  type ExpenseId,
  type InvoiceId,
  type MatterId,
  type OrganizationId,
  type TimeEntryId,
  type UserId,
} from "@/lib/shared/schemas/ids";
import type { SettlementRow, SettlementView, SettlementViewLine } from "@/lib/shared/settlement-view";
import { splitVat, DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { emit, type EmitCtx } from "../events/emit";
import type { BillingRunDetailRow, BillingRunListRow } from "../repositories/billing-run-repository";
import { nextInvoiceNumberFrom } from "../repositories/invoice-repository";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";

interface UnfrozenWork {
  timeEntries: Array<{ id: TimeEntryId; minutes: number; hourlyRate: number; billable: boolean; date: Date | string; description: string; kind?: "ARBETE" | "TIDSSPILLAN" | null | undefined }>;
  expenses: Array<{ id: ExpenseId; amount: number; billable: boolean; vatRate?: number | null; vatIncluded?: boolean | null }>;
}

/** En itemiserad rad i fakturaförslaget (#397) — tidspost med beräknat värde. */
interface ProposalTimeEntry {
  id: string;
  description: string;
  minutes: number;
  hourlyRate: number;
  billable: boolean;
  valueOre: number;
}

interface ProposalExpense {
  id: string;
  description: string;
  amount: number;
  billable: boolean;
}

/** Avdragsmedvetet fakturaförslag (#397): ofakturerade poster + nyckeltal. */
interface BillingProposal {
  workValueOre: number;
  priorAccontoSumOre: number;
  timeEntries: ProposalTimeEntry[];
  expenses: ProposalExpense[];
}

/** Värdet på en (debiterbar) tidspost i öre — speglar workValueOre:s ton. */
function timeEntryValueOre(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate);
}

/**
 * Minuter som rättshjälpsavgiften/coverage-splitten baseras på (#809): rättshjälp
 * exkluderar rådgivningstimmen — ärendets första timme loggas som vanlig tidspost
 * men faktureras klienten separat (rådgivningsavgiften) och ingår INTE i avgifts-
 * basen. Övriga betalningssätt: oförändrat.
 */
function coverageBaseMinutes(method: PaymentMethod, billableMinutes: number): number {
  return method === "RATTSHJALP" ? Math.max(0, billableMinutes - RADGIVNING_MINUTES) : billableMinutes;
}

/** Matter-fält som styr rättsskyddets tidsuppdelning + tak. */
interface RattsskyddMatter {
  paymentMethod: PaymentMethod;
  tvistUppkomDatum?: Date | string | null | undefined;
  rattsskyddBeslutDatum?: Date | string | null | undefined;
  rattsskyddMaxOre?: number | null | undefined;
  rattsskyddSjalvriskMinOre?: number | null | undefined;
}

/**
 * Rättsskydds-tillägg till computeCoverageSplit (#810): tidsuppdelar arbetet
 * (täckt del efter tvist/retro-tak) → `coveredOre`, samt försäkringens tak →
 * `capOre`. Tom för andra betalningssätt (då gäller standard-splitten).
 */
function rattsskyddCoverage(
  matter: RattsskyddMatter,
  entries: ReadonlyArray<{ date: Date | string; minutes: number; billable: boolean }>,
  rateOre: number,
): { coveredOre?: number; capOre?: number } {
  if (matter.paymentMethod !== "RATTSSKYDD") return {};
  const p = partitionRattsskyddMinutes(entries, matter.tvistUppkomDatum ?? null, matter.rattsskyddBeslutDatum ?? null);
  return omitUndefined({
    coveredOre: Math.round((p.coveredMinutes / 60) * rateOre),
    capOre: matter.rattsskyddMaxOre ?? undefined,
    minSjalvriskOre: matter.rattsskyddSjalvriskMinOre ?? undefined,
  });
}

async function fetchUnfrozenWork(repos: Repositories, matterId: MatterId): Promise<UnfrozenWork> {
  const te = await repos.timeEntries.listUnfrozenForMatter(matterId);
  const ex = await repos.expenses.listUnfrozenForMatter(matterId);
  return { timeEntries: te, expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

/** Det arbete en kostnadsräkning frös vid inskick (#806) — underlag för dom/
 *  slutreglering. PRUTNING-rader (skapas vid domen) länkas separat. */
async function fetchWorkByRun(repos: Repositories, billingRunId: BillingRunId): Promise<UnfrozenWork> {
  const te = await repos.timeEntries.listByBillingRun(billingRunId);
  const ex = await repos.expenses.listByBillingRun(billingRunId);
  return { timeEntries: te, expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

/**
 * Underlag för slutreglering (#806): väntar en kostnadsräkning på dom använder
 * vi dess frysta rader (rättshjälp), annars allt ofryst (rättsskydd har ingen
 * kostnadsräkning). Returnerar även körningen så den kan konsumeras vid domen.
 */
async function resolveSettlementWork(
  repos: Repositories, orgId: OrganizationId, matterId: MatterId,
): Promise<{ work: UnfrozenWork; krRun: BillingRunListRow | undefined }> {
  const runs = await repos.billingRuns.listForOrg(orgId, matterId);
  const krRun = runs.find((r) => r.type === "KOSTNADSRAKNING" && r.status === "PENDING_VERDICT");
  const work = krRun ? await fetchWorkByRun(repos, krRun.id) : await fetchUnfrozenWork(repos, matterId);
  return { work, krRun };
}

/** Bokar byråns prutningsförlust (rättshjälp) som icke-debiterbart PRUTNING-utlägg. */
async function bookFirmLoss(repos: Repositories, userId: UserId, matterId: MatterId, firmLossOre: number): Promise<void> {
  if (firmLossOre <= 0) return;
  await repos.expenses.create({
    matterId, userId, date: new Date(),
    amount: -firmLossOre, description: "Prutning — byrån bär (rättshjälp)",
    billable: false, vatRate: 0, vatIncluded: false, kind: "PRUTNING",
  });
}

interface PayerRunInput {
  matterId: MatterId; payerRecipient: BillingRunRecipient; payerInvoiceId: InvoiceId;
  payerGross: number; notes: string | null | undefined; krRun: BillingRunListRow | undefined;
}

/** Betalar-körningen vid slutreglering (#828): ALLTID en egen FINAL — kostnads-
 *  räkningen konsumeras inte längre in i fakturan (KR:n förblir distinkt med sitt
 *  dokument/beslut). Finns ingen KR (rättsskydd) fryses det ofrysta arbetet nu;
 *  finns en KR är arbetet redan fryst mot den. */
async function bookPayerRun(repos: Repositories, p: PayerRunInput): Promise<BillingRun> {
  const run = await repos.billingRuns.create({
    matterId: p.matterId, type: "FINAL", recipient: p.payerRecipient, status: "SENT",
    workValueOreAtRun: p.payerGross, proposedAmountOre: p.payerGross, amountOre: p.payerGross,
    invoiceId: p.payerInvoiceId, deductedBillingRunIds: [], periodTo: new Date(), notes: p.notes,
  });
  if (!p.krRun) await freezeWork(repos, p.matterId, run.id);
  return run;
}

/** Domsbeloppet för slutregleringen (#828): finns en kostnadsräkning måste den
 *  vara BESLUTAD (beslutet registrerat) och beloppet läses därifrån; annars
 *  (rättsskydd, ingen KR) används det inmatade beloppet. */
function resolveAwardedOre(krRun: BillingRunListRow | undefined, inputAwardedOre: number | undefined): number | null {
  if (!krRun) return inputAwardedOre ?? null;
  if (krRun.kostnadsrakningStatus !== "BESLUTAD") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Registrera domstolens beslut innan du skapar fakturan." });
  }
  return krRun.awardedOre ?? null;
}

/** Arvode netto (exkl. moms) — summa av debiterbara tidsposter. */
function arvodeNetOre(work: UnfrozenWork): number {
  return work.timeEntries
    .filter((t) => t.billable)
    .reduce((sum, t) => sum + timeEntryValueOre(t.minutes, t.hourlyRate), 0);
}

/** Ett utläggs moms-split (#782). Utlägg lagras netto (vatIncluded=false); äldre
 *  brutto-rader (vatIncluded=true) hanteras via flaggan så bruttot bevaras. */
function expenseSplit(e: { amount: number; vatRate?: number | null; vatIncluded?: boolean | null }) {
  return splitVat({ amount: e.amount, vatRate: e.vatRate ?? DEFAULT_VAT_RATE, vatIncluded: e.vatIncluded ?? false });
}

/** Debiterbara utlägg, netto (exkl. moms). */
function expenseNetOre(work: UnfrozenWork): number {
  return work.expenses.filter((e) => e.billable).reduce((sum, e) => sum + expenseSplit(e).exclVat, 0);
}

/** Debiterbara utlägg, brutto (inkl. moms) — det klienten/domstolen betalar. */
function expenseGrossOre(work: UnfrozenWork): number {
  return work.expenses.filter((e) => e.billable).reduce((sum, e) => sum + expenseSplit(e).inclVat, 0);
}

/** Nettovärde på arbetet: arvode (exkl moms) + utlägg (exkl moms). Bas för
 *  acconto-förslag och "upparbetat ofakturerat" — INTE fakturabeloppet (se invoiceGrossOre). */
function workValueOre(work: UnfrozenWork): number {
  return arvodeNetOre(work) + expenseNetOre(work);
}

/** Fakturans bruttobelopp: arvode + 25 % moms + utlägg. Alla fakturor lägger
 *  på moms på arvodet oavsett mottagare (#782). */
function invoiceGrossOre(work: UnfrozenWork): number {
  return arvodeInclVatOre(arvodeNetOre(work)) + expenseGrossOre(work);
}

/** Timarvodet (öre/tim) för en tidspost vid slutreglering (#891): rättshjälp
 *  värderas retroaktivt på SLUTREGLERINGSÅRETS norm — arbete på timkostnadsnormen,
 *  tidsspillan på den (lägre) tidsspillan-normen. */
function rattshjalpEntryRateOre(kind: "ARBETE" | "TIDSSPILLAN" | null | undefined, settleDate: Date | string): number {
  return kind === "TIDSSPILLAN" ? tidsspillanFtaxForDate(settleDate) : timkostnadsnormFtaxForDate(settleDate);
}

/**
 * Slutregleringens arvode-netto (#891). RÄTTSHJÄLP: räkna om HELA ärendet på
 * SLUTREGLERINGSÅRETS normer — den retroaktiva höjningen över ett årsskifte (arbete
 * 2025 värderas på 2026 års norm). Arbete värderas på timkostnadsnormen (minus
 * rådgivningstimmen), tidsspillan på tidsspillan-normen. Övriga metoder: platt
 * `flatRateOre` × alla debiterbara minuter (oförändrat).
 */
function settlementArvodeNet(method: PaymentMethod, work: UnfrozenWork, settleDate: Date | string, flatRateOre: number): number {
  const billable = work.timeEntries.filter((t) => t.billable);
  const billableMin = billable.reduce((s, t) => s + t.minutes, 0);
  if (method !== "RATTSHJALP") return Math.round((billableMin / 60) * flatRateOre);
  const tidsMin = billable.filter((t) => t.kind === "TIDSSPILLAN").reduce((s, t) => s + t.minutes, 0);
  const arbeteMin = coverageBaseMinutes("RATTSHJALP", billableMin - tidsMin); // − rådgivningstimmen
  return Math.round((arbeteMin / 60) * timkostnadsnormFtaxForDate(settleDate))
    + Math.round((tidsMin / 60) * tidsspillanFtaxForDate(settleDate));
}

/**
 * Rättshjälpens KR-anspråk till domstol, brutto (#839/#891): arbetet värderas på
 * TIMKOSTNADSNORMEN (staten ersätter bara normen, ej byråns taxa), tidsspillan på
 * tidsspillan-normen, rådgivningstimmen exkluderas. Utlägg ersätts brutto.
 */
function rattshjalpKrGrossOre(work: UnfrozenWork, settleDate: Date | string): number {
  return arvodeInclVatOre(settlementArvodeNet("RATTSHJALP", work, settleDate, 0)) + expenseGrossOre(work);
}

/** Fakturans exakta momsbelopp (öre) per sats: arvodets moms (25 %) +
 *  varje utläggs moms (dess sats). Lagras på fakturan för korrekt bokföring (#782). */
function invoiceVatOre(work: UnfrozenWork): number {
  const arvodeNet = arvodeNetOre(work);
  const arvodeVat = arvodeInclVatOre(arvodeNet) - arvodeNet;
  const expenseVat = work.expenses.filter((e) => e.billable).reduce((sum, e) => sum + expenseSplit(e).vat, 0);
  return arvodeVat + expenseVat;
}

/** En arvode-breakdown-rad (25 % moms) ur ett netto-arvode; null om 0. */
function arvodeLine(arvodeNet: number): VatBreakdownLine | null {
  if (arvodeNet <= 0) return null;
  return { kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: arvodeNet, vatOre: arvodeInclVatOre(arvodeNet) - arvodeNet };
}

/** Utläggens moms-uppdelning, en rad per förekommande momssats. */
function expenseBreakdownLines(work: UnfrozenWork): VatBreakdownLine[] {
  const byRate = new Map<number, { netOre: number; vatOre: number }>();
  for (const e of work.expenses.filter((x) => x.billable)) {
    const rate = e.vatRate ?? DEFAULT_VAT_RATE;
    const s = expenseSplit(e);
    const acc = byRate.get(rate) ?? { netOre: 0, vatOre: 0 };
    byRate.set(rate, { netOre: acc.netOre + s.exclVat, vatOre: acc.vatOre + s.vat });
  }
  return [...byRate].map(([vatRate, v]) => ({ kind: "utlagg" as const, vatRate, netOre: v.netOre, vatOre: v.vatOre }));
}

/** Fakturans moms-uppdelning per sats (#790): en arvode-rad (25 %) + en utläggs-
 *  rad per förekommande momssats. Driver per-sats bokföring i verifikat/SIE. */
function invoiceVatBreakdown(work: UnfrozenWork): VatBreakdownLine[] {
  const arvode = arvodeLine(arvodeNetOre(work));
  return [...(arvode ? [arvode] : []), ...expenseBreakdownLines(work)];
}

/** Summa moms (öre) ur en breakdown. */
function vatOreOf(lines: VatBreakdownLine[]): number {
  return lines.reduce((s, l) => s + l.vatOre, 0);
}

/** Brutto (öre) ur en breakdown: netto + moms. */
function grossOreOf(lines: VatBreakdownLine[]): number {
  return lines.reduce((s, l) => s + l.netOre + l.vatOre, 0);
}

/**
 * Det DÅ GÄLLANDE timarvodet (öre/tim) som arbetet ska värderas om på vid
 * fakturering (#800): rättshjälp → timkostnadsnormen (F-skatt-variant);
 * rättsskydd m.fl. → ansvariga juristens AKTUELLA timtaxa (ej snapshot).
 */
async function currentArvodeRateOre(
  repos: Repositories,
  orgId: OrganizationId,
  matter: { paymentMethod: string; taxaHasFTax?: boolean | null | undefined; responsibleLawyerId?: UserId | null | undefined },
): Promise<number> {
  if (matter.paymentMethod === "RATTSHJALP") {
    // Alla advokater har F-skatt (#839) → alltid F-skatt-normen, oberoende av
    // matter.taxaHasFTax (ett brottmåls-taxefält som är meningslöst här).
    return TIMKOSTNADSNORM_FTAX_ORE_PER_H;
  }
  if (!matter.responsibleLawyerId) return 0;
  const lawyer = await repos.users.getByIdInOrg(matter.responsibleLawyerId, orgId);
  return lawyer?.hourlyRate ?? 0;
}

/** Dela utläggs-raderna mellan klient och betalare med SAMMA andel som arvodet
 *  (#878): klientens andel = clientOre/effectiveTotal. Betalaren får resten (så
 *  öre-avrundning aldrig tappas). Per momssats-rad delas netto + moms var för sig. */
function apportionExpenseLines(lines: VatBreakdownLine[], split: CoverageSplit): { clientLines: VatBreakdownLine[]; payerLines: VatBreakdownLine[] } {
  const denom = split.effectiveTotalOre;
  const clientLines: VatBreakdownLine[] = [];
  const payerLines: VatBreakdownLine[] = [];
  for (const l of lines) {
    const clientNet = denom > 0 ? Math.round((l.netOre * split.clientOre) / denom) : 0;
    const clientVat = denom > 0 ? Math.round((l.vatOre * split.clientOre) / denom) : 0;
    if (clientNet + clientVat > 0) clientLines.push({ ...l, netOre: clientNet, vatOre: clientVat });
    const payerNet = l.netOre - clientNet;
    const payerVat = l.vatOre - clientVat;
    if (payerNet + payerVat > 0) payerLines.push({ ...l, netOre: payerNet, vatOre: payerVat });
  }
  return { clientLines, payerLines };
}

/** Faktura-rader (moms-breakdown) för klient- resp. betalar-fakturan ur en
 *  prutnings-/rättshjälpsavgifts-uppdelning (#801). Både arvode OCH utlägg delas
 *  per samma klient/betalar-andel (#878). */
function coverageInvoiceLines(split: CoverageSplit, work: UnfrozenWork): { clientLines: VatBreakdownLine[]; payerLines: VatBreakdownLine[] } {
  const clientArvode = arvodeLine(split.clientOre);
  const payerArvode = arvodeLine(split.payerOre);
  const exp = apportionExpenseLines(expenseBreakdownLines(work), split);
  return {
    clientLines: [...(clientArvode ? [clientArvode] : []), ...exp.clientLines],
    payerLines: [...(payerArvode ? [payerArvode] : []), ...exp.payerLines],
  };
}

/** Bygg ett itemiserat fakturaförslag ur ofrysta tids-/utläggsrader (#397). */
function buildProposal(
  te: ReadonlyArray<{ id: string; description?: string | null; minutes: number; hourlyRate: number; billable: boolean }>,
  ex: ReadonlyArray<{ id: string; description?: string | null; amount: number; billable: boolean; kind?: ExpenseKind }>,
  priorAccontoSumOre: number,
): BillingProposal {
  const timeEntries: ProposalTimeEntry[] = te.map((t) => ({
    id: t.id, description: t.description ?? "", minutes: t.minutes, hourlyRate: t.hourlyRate,
    billable: t.billable, valueOre: timeEntryValueOre(t.minutes, t.hourlyRate),
  }));
  const expenses: ProposalExpense[] = ex
    .filter((e) => e.kind !== "PRUTNING")
    .map((e) => ({ id: e.id, description: e.description ?? "", amount: e.amount, billable: e.billable }));
  const workValueOre = timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.valueOre, 0)
    + expenses.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0);
  return { workValueOre, priorAccontoSumOre, timeEntries, expenses };
}

/** Summan av tidigare utställda ACCONTO-fakturors belopp för ett ärende (#397). */
async function sumPriorAccontos(repos: Repositories, matterId: MatterId): Promise<number> {
  const runs = (await repos.billingRuns.listAccontoSent(matterId)) as ReadonlyArray<{ amountOre?: number }>;
  return runs.reduce((sum, r) => sum + (r.amountOre ?? 0), 0);
}

async function freezeWork(repos: Repositories, matterId: MatterId, billingRunId: BillingRunId): Promise<void> {
  const now = new Date();
  await repos.timeEntries.freezeForMatter(matterId, billingRunId, now);
  await repos.expenses.freezeForMatter(matterId, billingRunId, now);
}

// ── Fakturaspecifikation (#856) ─────────────────────────────────────────────

/** En rad i fakturans tidsspecifikation (belopp = timmar × gällande timarvode). */
interface SpecTimeLine { date: Date | string; description: string; minutes: number; amountOre: number; }
/** En rad i utläggsspecifikationen (netto + brutto, exakt per momssats). */
interface SpecExpenseLine { date: Date | string; description: string; netOre: number; grossOre: number; }
/** En avdragen (tidigare betald) aconto-faktura. */
interface SpecDeduction { invoiceNumber: string; date: Date | string | null; amountOre: number; }

/**
 * Fakturans fullständiga specifikation (#856): itemiserade tider + utlägg,
 * avdragna aconto-fakturor och summering. `payableOre` = fakturans FAKTISKA
 * belopp; `adjustmentOre` fångar ev. differens (rättshjälps-/rättsskyddssplit,
 * prutning) mellan brutto−avdrag och det som faktureras — visas på en egen rad.
 */
interface InvoiceSpecification {
  timeLines: SpecTimeLine[];
  expenseLines: SpecExpenseLine[];
  totalMinutes: number;
  arvodeNetOre: number; arvodeVatOre: number;
  expensesNetOre: number; expensesVatOre: number;
  grossOre: number;
  deductions: SpecDeduction[];
  deductionOre: number;
  adjustmentOre: number;
  payableOre: number;
}

function specTimeLines(
  method: PaymentMethod, normRateOre: number,
  entries: ReadonlyArray<{ date: Date | string; description: string; minutes: number; hourlyRate: number; billable: boolean }>,
): SpecTimeLine[] {
  return entries.filter((t) => t.billable).map((t) => ({
    date: t.date, description: t.description, minutes: t.minutes,
    // Rättshjälp värderas enhetligt på timkostnadsnormen (#839); övriga per post-taxa.
    amountOre: timeEntryValueOre(t.minutes, method === "RATTSHJALP" ? normRateOre : t.hourlyRate),
  }));
}

function specExpenseLines(
  expenses: ReadonlyArray<{ date: Date | string; description: string; amount: number; billable: boolean; vatRate?: number | null; vatIncluded?: boolean | null }>,
): SpecExpenseLine[] {
  return expenses.filter((e) => e.billable).map((e) => {
    const s = expenseSplit(e);
    return { date: e.date, description: e.description, netOre: s.exclVat, grossOre: s.exclVat + s.vat };
  });
}

function buildInvoiceSpecification(a: {
  timeLines: SpecTimeLine[]; expenseLines: SpecExpenseLine[]; deductions: SpecDeduction[]; payableOre: number;
}): InvoiceSpecification {
  const arvodeNetOre = a.timeLines.reduce((s, l) => s + l.amountOre, 0);
  const arvodeVatOre = arvodeInclVatOre(arvodeNetOre) - arvodeNetOre;
  const expensesNetOre = a.expenseLines.reduce((s, l) => s + l.netOre, 0);
  const expensesVatOre = a.expenseLines.reduce((s, l) => s + (l.grossOre - l.netOre), 0);
  const deductionOre = a.deductions.reduce((s, d) => s + d.amountOre, 0);
  // Brutto före avdrag. Har fakturan itemiserat arbete → summan av raderna.
  // Saknas rader (t.ex. klientens självrisk-faktura, vars arbete ligger på
  // betalar-fakturan) → härled ur det fakturerade + avdragen, så avdragen kan
  // visas transparent (belopp − aconton = att betala) utan negativ justering.
  const hasLines = a.timeLines.length > 0 || a.expenseLines.length > 0;
  const grossOre = hasLines ? arvodeNetOre + arvodeVatOre + expensesNetOre + expensesVatOre : a.payableOre + deductionOre;
  return {
    timeLines: a.timeLines, expenseLines: a.expenseLines,
    totalMinutes: a.timeLines.reduce((s, l) => s + l.minutes, 0),
    arvodeNetOre, arvodeVatOre, expensesNetOre, expensesVatOre, grossOre,
    deductions: a.deductions, deductionOre,
    adjustmentOre: a.payableOre - (grossOre - deductionOre),
    payableOre: a.payableOre,
  };
}

/**
 * Länka slutregleringens arbete + aconto-avdrag till fakturorna (#856): arbetet
 * (arvode+utlägg) bärs av betalar-fakturan, aconto-avdragen registreras på
 * klientfakturan → fakturaspecifikationen kan hämtas per faktura och slutfaktura-
 * vyn slutar visa 0.00. Utbrutet så settleCoverage-handlern håller sig ≤8.
 */
async function linkSettlementInvoices(repos: Repositories, a: {
  work: UnfrozenWork; payerInvoiceId: InvoiceId; clientInvoiceId: InvoiceId; deductedRuns: ReadonlyArray<{ invoiceId?: InvoiceId | null | undefined }>;
}): Promise<void> {
  await repos.timeEntries.flagBilled(a.work.timeEntries.filter((t) => t.billable).map((t) => t.id), a.payerInvoiceId);
  await repos.expenses.flagBilled(a.work.expenses.filter((e) => e.billable).map((e) => e.id), a.payerInvoiceId);
  for (const r of a.deductedRuns) {
    if (r.invoiceId) await repos.accontoDeductions.create({ finalInvoiceId: a.clientInvoiceId, accontoInvoiceId: r.invoiceId });
  }
}

/** Hämta + montera avdragna aconto-fakturor för en slutfaktura (#856). */
async function fetchSpecDeductions(repos: Repositories, orgId: OrganizationId, finalInvoiceId: InvoiceId): Promise<SpecDeduction[]> {
  const links = await repos.accontoDeductions.listByFinalInvoice(finalInvoiceId);
  const out: SpecDeduction[] = [];
  for (const link of links) {
    const inv = await repos.invoices.getByIdInOrg(link.accontoInvoiceId, orgId);
    if (inv) out.push({ invoiceNumber: inv.invoiceNumber ?? "—", date: inv.invoiceDate ?? null, amountOre: inv.amount });
  }
  return out;
}

/**
 * Slutregleringens itemiserade nedbrytning (#858) — så BÅDE domstols- och
 * klientfakturan blir självförklarande. Rena display-siffror (brutto, öre); ÄNDRAR
 * inga belopp (klient = självrisk − aconton, domstol = statens andel, oförändrat):
 *   - domstolsfakturan bryter ned "Nedsättning" i självrisk/rådgivning/prutning,
 *   - klientfakturan visar självrisk-uträkningen (andel × upparbetat),
 *   - avdragna aconton listas (avräknas EN gång, på klientfakturan; info på domstol).
 */
export interface SettlementBreakdown {
  clientShareBips: number;
  arvodeBaseNetOre: number;      // bas-arvode (exkl rådgivning), netto — "andel × X"
  baseArvodeGrossOre: number;    // bas-arvode (exkl rådgivning), brutto — domstolens arvode-rad
  expensesGrossOre: number;      // utlägg brutto — BETALARENS andel (#878)
  clientExpensesGrossOre: number; // utlägg brutto — KLIENTENS andel (#878)
  sjalvriskNetOre: number;       // klientens självrisk NETTO (andel × arvodeBaseNet) — moms-trappan (#876)
  sjalvriskGrossOre: number;     // klientens självrisk brutto
  firmLossNetOre: number;        // byrå-förlust/prutning NETTO — domstolens trappa (#876)
  prutningGrossOre: number;      // byrå-förlust/prutning brutto
  payerArvodeNetOre: number;     // domstolens/försäkringens andel av arvodet NETTO — trappan (#876)
  radgivningGrossOre: number;    // klient-betald rådgivningstimme brutto — omnämns på domstolsfakturan, ej i totalen (#876)
  payerPayableOre: number;       // domstolen att betala
  clientPayableOre: number;      // klienten att betala (självrisk − aconton)
  // Klientens självrisk-faktura specificeras med den arbetade tiden (#876). Raderna
  // är carvade (rättshjälp: rådgivningstimmen bort) + avstämda så summan = arvodeBaseNetOre.
  clientArvodeLines: SpecTimeLine[];
  deductedAccontos: SpecDeduction[];
}

/** Klientfakturans tidsspec (#876): arbetad tid, rådgivningstimmen carvad bort
 *  (rättshjälp), värderad på samma rate som arvodesbasen och AVSTÄMD så radernas
 *  summa exakt = `totalArvodeNet` (per-rad-avrundning läggs på sista raden). */
function buildClientArvodeLines(
  method: PaymentMethod, rateOre: number, work: UnfrozenWork, totalArvodeNet: number, settleDate: Date | string,
): SpecTimeLine[] {
  const billable = work.timeEntries.filter((t) => t.billable);
  const entries = method === "RATTSHJALP" ? carveEarliestMinutes(billable, RADGIVNING_MINUTES) : billable;
  // #891: rättshjälp värderar varje rad på slutregleringsårets norm per kategori
  // (arbete vs tidsspillan); övriga metoder → den platta raten.
  const lineRate = (kind: "ARBETE" | "TIDSSPILLAN" | null | undefined): number =>
    method === "RATTSHJALP" ? rattshjalpEntryRateOre(kind, settleDate) : rateOre;
  const lines: SpecTimeLine[] = entries.map((t) => ({
    date: t.date, description: t.description, minutes: t.minutes,
    amountOre: timeEntryValueOre(t.minutes, lineRate(t.kind)),
  }));
  const sum = lines.reduce((s, l) => s + l.amountOre, 0);
  const last = lines[lines.length - 1];
  if (last && sum !== totalArvodeNet) last.amountOre += totalArvodeNet - sum; // avstämning (öre)
  return lines;
}

async function buildSettlementBreakdown(repos: Repositories, orgId: OrganizationId, a: {
  clientShareBips: number; totalArvodeNet: number; split: CoverageSplit; work: UnfrozenWork;
  payerGross: number; clientPayable: number; method: PaymentMethod; rateOre: number; settleDate: Date | string;
  deductedRuns: ReadonlyArray<{ invoiceId?: InvoiceId | null | undefined }>;
}): Promise<SettlementBreakdown> {
  // Rådgivningstimmen ingår ALDRIG i domstolens arvode (#860) — arvodet värderas
  // på bas-minuterna (exkl rådgivning). Rådgivningen syns bara i kostnadsräkningen.
  // Utlägg delas per samma andel som arvodet (#878): klientens del + betalarens del.
  const exp = apportionExpenseLines(expenseBreakdownLines(a.work), a.split);
  const clientExpensesGrossOre = grossOreOf(exp.clientLines);
  const payerExpensesGrossOre = grossOreOf(exp.payerLines);
  const deductedAccontos: SpecDeduction[] = [];
  for (const r of a.deductedRuns) {
    if (!r.invoiceId) continue;
    const inv = await repos.invoices.getByIdInOrg(r.invoiceId, orgId);
    if (inv) deductedAccontos.push({ invoiceNumber: inv.invoiceNumber ?? "—", date: inv.invoiceDate ?? null, amountOre: inv.amount });
  }
  return {
    clientShareBips: a.clientShareBips,
    arvodeBaseNetOre: a.totalArvodeNet,
    baseArvodeGrossOre: arvodeInclVatOre(a.totalArvodeNet),
    expensesGrossOre: payerExpensesGrossOre,
    clientExpensesGrossOre,
    sjalvriskNetOre: a.split.clientOre,
    sjalvriskGrossOre: arvodeInclVatOre(a.split.clientOre),
    firmLossNetOre: a.split.firmLossOre,
    prutningGrossOre: arvodeInclVatOre(a.split.firmLossOre),
    payerArvodeNetOre: a.split.payerOre,
    // Rådgivningstimmen (1 h) betalas av klienten separat; värdet = en timme på samma
    // norm som arvodesbasen (jfr coverageBaseMinutes −60). 0 för icke-rättshjälp.
    radgivningGrossOre: a.method === "RATTSHJALP" ? arvodeInclVatOre(a.rateOre) : 0,
    payerPayableOre: a.payerGross,
    clientPayableOre: a.clientPayable,
    clientArvodeLines: buildClientArvodeLines(a.method, a.rateOre, a.work, a.totalArvodeNet, a.settleDate),
    deductedAccontos,
  };
}

const svd = (d: Date | string | null | undefined): string => (d ? new Date(d).toLocaleDateString("sv-SE") : "");
const toViewLine = (l: SpecTimeLine): SettlementViewLine => ({
  date: new Date(l.date).toISOString().slice(0, 10), description: l.description, minutes: l.minutes, amountOre: l.amountOre,
});

/**
 * Persisterad slutregleringsvy (#876) — EN källa för både faktura-dokumentet och
 * Slutfaktura-sidan. Byggdes tidigare i `_settlement-dialog.tsx`; flyttad hit så
 * servern äger raderna och sparar dem på fakturan (`settlementBreakdown`).
 *
 * KLIENT (rättshjälpsavgift/självrisk): tidsspec + moms-trappa (netto → andel →
 * moms → inkl) + klientens utläggsandel (#878). `feeTerm` = "rättshjälpsavgift"
 * (rättshjälp) eller "självrisk" (rättsskydd).
 */
function buildClientView(b: SettlementBreakdown, isRattshjalp: boolean, feeTerm: string): SettlementView {
  const share = (b.clientShareBips / 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 });
  const feeCap = feeTerm.charAt(0).toUpperCase() + feeTerm.slice(1);
  const rows: SettlementRow[] = [];
  if (isRattshjalp) {
    rows.push({ label: "Upparbetat arvode (exkl moms)", amountOre: b.arvodeBaseNetOre, kind: "add" });
    rows.push({ label: `Klientens ${feeTerm} ${share} % (exkl moms)`, amountOre: b.sjalvriskNetOre, kind: "add" });
    rows.push({ label: "Moms 25 %", amountOre: b.sjalvriskGrossOre - b.sjalvriskNetOre, kind: "add" });
    rows.push({ label: `${feeCap} (inkl moms)`, amountOre: b.sjalvriskGrossOre, kind: "add" });
  } else {
    rows.push({ label: "Klientens del / självrisk (inkl moms)", amountOre: b.sjalvriskGrossOre, kind: "add" });
  }
  if (b.clientExpensesGrossOre > 0) rows.push({ label: "Utlägg (klientens andel, inkl moms)", amountOre: b.clientExpensesGrossOre, kind: "add" });
  for (const d of b.deductedAccontos) rows.push({ label: `Avgår aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svd(d.date)})` : ""}`, amountOre: d.amountOre, kind: "deduct" });
  return { timeLines: b.clientArvodeLines.map(toViewLine), rows, totalLabel: "Att betala (inkl moms)", totalOre: b.clientPayableOre };
}

/**
 * BETALARE (domstol/försäkring): SAMMA upplägg som klientfakturan (#876) — tidsspec
 * + moms-trappa, fast med betalarens ANDEL. Bas-arvode − klientens rättshjälpsavgift
 * − ev. prutning = betalarens andel (netto) → moms → inkl + betalarens utläggsandel
 * (#878). Rådgivningstimmen omnämns som info-rad men ligger UTANFÖR totalen.
 */
function buildPayerView(b: SettlementBreakdown, payerLabel: string, payerNoun: string, feeTerm: string): SettlementView {
  const payerArvodeGross = arvodeInclVatOre(b.payerArvodeNetOre);
  const rows: SettlementRow[] = [
    { label: "Upparbetat arvode (exkl moms)", amountOre: b.arvodeBaseNetOre, kind: "add" },
    { label: `Avgår klientens ${feeTerm} (exkl moms)`, amountOre: b.sjalvriskNetOre, kind: "deduct" },
  ];
  if (b.firmLossNetOre > 0) rows.push({ label: "Avgår prutning (byrån bär) (exkl moms)", amountOre: b.firmLossNetOre, kind: "deduct" });
  rows.push({ label: `${payerNoun} andel av arvodet (exkl moms)`, amountOre: b.payerArvodeNetOre, kind: "add" });
  rows.push({ label: "Moms 25 %", amountOre: payerArvodeGross - b.payerArvodeNetOre, kind: "add" });
  rows.push({ label: `${payerNoun} arvode (inkl moms)`, amountOre: payerArvodeGross, kind: "add" });
  if (b.expensesGrossOre > 0) rows.push({ label: `Utlägg (${payerNoun.toLowerCase()} andel, inkl moms)`, amountOre: b.expensesGrossOre, kind: "add" });
  if (b.radgivningGrossOre > 0) rows.push({ label: radgivningTextRad("faktura"), amountOre: b.radgivningGrossOre, kind: "info" });
  for (const d of b.deductedAccontos) rows.push({ label: `Betalt via aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svd(d.date)})` : ""}`, amountOre: d.amountOre, kind: "info" });
  return { timeLines: b.clientArvodeLines.map(toViewLine), rows, totalLabel: `${payerLabel} — att betala (inkl moms)`, totalOre: b.payerPayableOre };
}

/** Klient- + betalar-vy ur nedbrytningen (#876) — etiketterna följer metoden.
 *  Rättshjälp: klientens del = "rättshjälpsavgift"; rättsskydd: "självrisk" (#878). */
function buildSettlementViews(b: SettlementBreakdown, method: PaymentMethod): { clientView: SettlementView; payerView: SettlementView } {
  const isRattshjalp = method === "RATTSHJALP";
  const payerLabel = isRattshjalp ? "Domstolen betalar" : "Försäkringen betalar";
  const payerNoun = isRattshjalp ? "Domstolens" : "Försäkringens";
  const feeTerm = isRattshjalp ? "rättshjälpsavgift" : "självrisk";
  return { clientView: buildClientView(b, isRattshjalp, feeTerm), payerView: buildPayerView(b, payerLabel, payerNoun, feeTerm) };
}

/** Kreditvy (#895): SAMMA fulla specifikation som klientens slutfaktura (tidsspec
 *  med á-pris + rättshjälpsavgift-trappan + avdragna aconton, jfr domstolsvyn) — men
 *  eftersom betalda aconton översteg klientens slutliga andel blir nettot NEGATIVT →
 *  en kreditering. Återanvänder `clientView` och byter bara total-etikett + belopp. */
function buildCreditView(clientView: SettlementView, creditNetOre: number): SettlementView {
  return { ...clientView, totalLabel: "Kreditering till klienten (inkl moms)", totalOre: creditNetOre };
}

/**
 * Klientens slutfaktura vid slutreglering (#878): EN faktura, aldrig en 0.00-rad.
 * Nettot = klientens slutliga andel − betalda aconton:
 *   - > 0 → FINAL (klienten är skyldig resten),
 *   - < 0 → CREDIT (överfakturerad via aconton → mellanskillnaden krediteras),
 *   - = 0 → FINAL 0 (exakt avräknad; ovanligt).
 * Utbrutet så settleCoverage-handlern håller sig ≤8 i komplexitet.
 */
async function createClientSettlementInvoice(repos: Repositories, ctx: EmitCtx, orgId: OrganizationId, a: {
  matterId: MatterId; clientGrossOre: number; deductionOre: number;
  clientLines: VatBreakdownLine[]; clientView: SettlementView; method: PaymentMethod; notes: string | null | undefined;
}): Promise<{ invoice: Invoice; creditInvoice: Invoice | null }> {
  const clientNet = a.clientGrossOre - a.deductionOre; // kan vara negativt (överbetald)
  const isCredit = clientNet < 0;
  const feeTerm = a.method === "RATTSHJALP" ? "rättshjälpsavgift" : "självrisk";
  const overpaidOre = -clientNet;
  const base = { matterId: a.matterId, amount: clientNet, ...(await invoiceNumbering(repos, orgId, "KLIENT")), invoiceDate: new Date() };
  const payload = isCredit
    ? {
        ...base,
        // Kredit-moms = 25 %-andelen av det överbetalda bruttot (arvode dominerar).
        vatOre: -Math.round(overpaidOre - overpaidOre / 1.25),
        // #895: full spec (tidsspec + rättshjälpsavgift + avdragna aconton) → kredit-netto.
        settlementBreakdown: buildCreditView(a.clientView, clientNet),
        invoiceType: "CREDIT" as const, status: "SENT" as const,
        notes: `Rättshjälps-överfakturering: betalda aconton (${(a.deductionOre / 100).toLocaleString("sv-SE")} kr) översteg slutlig ${feeTerm} — mellanskillnaden krediteras klienten.`,
      }
    : {
        ...base, vatOre: vatOreOf(a.clientLines), vatBreakdown: a.clientLines,
        settlementBreakdown: a.clientView, invoiceType: "FINAL" as const, status: "DRAFT" as const, notes: a.notes,
      };
  const invoice = await repos.invoices.create(payload);
  await emit.invoiceCreated(ctx, invoice);
  return { invoice, creditInvoice: isCredit ? invoice : null };
}

/**
 * Koppla de DEBITERBARA frysta posterna till FINAL-fakturan (invoice_id) +
 * registrera acconto-avdrag. Utan detta härleder slutfaktura-vyn `0.00` för
 * arvode/utlägg (den summerar bara fakture-länkade poster) trots korrekt
 * totalbelopp — frysning ensam räcker inte. Gör en billing-run-faktura
 * identisk (för vy/ledger) med en legacy-skapad (#728). `work` är de poster
 * som precis frystes; bara `billable` ingår i fakturabeloppet (jfr workValueOre).
 */
async function linkFinalInvoice(
  repos: Repositories,
  invoiceId: InvoiceId,
  work: UnfrozenWork,
  deductedAccontoInvoiceIds: ReadonlyArray<InvoiceId>,
): Promise<void> {
  await repos.timeEntries.flagBilled(work.timeEntries.filter((t) => t.billable).map((t) => t.id), invoiceId);
  await repos.expenses.flagBilled(work.expenses.filter((e) => e.billable).map((e) => e.id), invoiceId);
  for (const accontoInvoiceId of deductedAccontoInvoiceIds) {
    await repos.accontoDeductions.create({ finalInvoiceId: invoiceId, accontoInvoiceId });
  }
}

/**
 * Vilket arbete ska slutfaktureras (#734)? Anges `timeEntryIds`/`expenseIds`
 * fakturerar vi ENBART dem (per-post-val, validerade som ofakturerade i ärendet);
 * utelämnas båda tar vi allt ofryst (modellens default). PRUTNING-utlägg utesluts
 * (de länkas separat i kostnadsräknings-flödet).
 */
async function resolveFinalWork(
  repos: Repositories,
  matterId: MatterId,
  timeEntryIds: TimeEntryId[] | undefined,
  expenseIds: ExpenseId[] | undefined,
): Promise<{ work: UnfrozenWork; selected: boolean }> {
  if (timeEntryIds === undefined && expenseIds === undefined) {
    return { work: await fetchUnfrozenWork(repos, matterId), selected: false };
  }
  const teIds = timeEntryIds ?? [];
  const exIds = expenseIds ?? [];
  const selTime = await repos.timeEntries.listUnbilled(matterId, teIds);
  const selExp = await repos.expenses.listUnbilled(matterId, exIds);
  if (selTime.length !== teIds.length || selExp.length !== exIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Någon vald post är redan fakturerad eller tillhör annat ärende." });
  }
  return {
    work: {
      timeEntries: selTime.map((t) => ({ id: t.id, minutes: t.minutes, hourlyRate: t.user.hourlyRate ?? 0, billable: t.billable, date: t.date, description: t.description })),
      expenses: selExp.filter((e) => e.kind !== "PRUTNING").map((e) => ({ id: e.id, amount: e.amount, billable: e.billable, vatRate: e.vatRate, vatIncluded: e.vatIncluded })),
    },
    selected: true,
  };
}

/** Frys valda poster (per-post) eller hela ärendet (default). */
async function freezeSelectedWork(
  repos: Repositories,
  matterId: MatterId,
  work: UnfrozenWork,
  selected: boolean,
  runId: BillingRunId,
): Promise<void> {
  if (!selected) {
    await freezeWork(repos, matterId, runId);
    return;
  }
  const now = new Date();
  await repos.timeEntries.freezeByIds(work.timeEntries.map((t) => t.id), runId, now);
  await repos.expenses.freezeByIds(work.expenses.map((e) => e.id), runId, now);
}

/** KR-tillstånd ur en körning (#828); saknad status → INSKICKAD (äldre KR). */
function krStateOf(run: { kostnadsrakningStatus?: KostnadsrakningStatus | null | undefined; beslutSlutgiltigt?: boolean | null | undefined }): KostnadsrakningState {
  return { status: run.kostnadsrakningStatus ?? "INSKICKAD", slutgiltigt: run.beslutSlutgiltigt ?? false };
}

/** Hämta en KOSTNADSRAKNING-körning org-scopat; kastar om saknad/fel typ. */
async function assertKostnadsrakning(repos: Repositories, billingRunId: BillingRunId, orgId: OrganizationId): Promise<BillingRunDetailRow> {
  const run = await repos.billingRuns.getByIdInOrg(billingRunId, orgId);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Kostnadsräkningen finns inte." });
  if (run.type !== "KOSTNADSRAKNING") throw new TRPCError({ code: "BAD_REQUEST", message: "Åtgärden gäller bara kostnadsräkningar." });
  return run;
}

/** Applicera en KR-övergång; översätt otillåten övergång till TRPCError. */
function applyKrTransition(state: KostnadsrakningState, action: KostnadsrakningAction): KostnadsrakningState {
  try {
    return applyKrAction(state, action);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Otillåten kostnadsräknings-övergång." });
  }
}

/**
 * Flödes-guard (#816 fas 3): säkerställer att ärendet finns OCH att `action` är
 * laglig i ärendets nuvarande fas enligt billing-flow-modellen (samma sanningskälla
 * som UI:t). Hård enforcement för ALLA betalningssätt — skyddar mot stale klienter
 * / direkt-API som tar ett otillåtet steg (t.ex. slutreglera ett PRIVAT-ärende
 * eller fakturera ett nekat rättsskydd).
 */
async function assertFlowAction(repos: Repositories, orgId: OrganizationId, matterId: MatterId, action: BillingActionType): Promise<void> {
  const matter = await repos.matters.getByIdInOrg(matterId, orgId);
  if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
  const runs = await repos.billingRuns.listForOrg(orgId, matterId);
  try {
    assertBillingTransition({ paymentMethod: matter.paymentMethod, rattsskyddNekadAt: matter.rattsskyddNekadAt }, runs, action);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Otillåten faktureringsåtgärd." });
  }
}

/**
 * Tilldela fakturanummer + OCR (ADR 0012). Alla fakturor får `F-YYYY-NNNN`
 * (#889 — så domstolsfakturan syns i samma format som övriga i listan), MEN
 * domstolsfakturor får ingen OCR: domstolen betalar på beslut, inte via OCR.
 */
async function invoiceNumbering(
  repos: Repositories,
  orgId: OrganizationId,
  recipient: BillingRunRecipient,
): Promise<{ invoiceNumber: string; ocrReference: string | null }> {
  const invoiceNumber = await repos.invoices.nextInvoiceNumber(orgId);
  return { invoiceNumber, ocrReference: recipient === "DOMSTOL" ? null : ocrFromInvoiceNumber(invoiceNumber) };
}

/** Nästa kostnadsräknings-referens `KR-YYYY-NNNN` (#889) — firmagemensam sekvens
 *  per år, härledd ur befintliga KR-körningars referens. */
async function nextKrReference(repos: Repositories, orgId: OrganizationId): Promise<string> {
  const prefix = `KR-${new Date().getFullYear()}-`;
  const runs = await repos.billingRuns.listForOrg(orgId);
  const last = runs
    .map((r) => (r as { reference?: string | null }).reference)
    .filter((ref): ref is string => !!ref && ref.startsWith(prefix))
    .sort()
    .pop();
  return nextInvoiceNumberFrom(prefix, last);
}

/**
 * Valfritt klient-id + datum (paritet med legacy `invoice.createFinal` så demo-
 * generatorn/fixtures kan styra dem). Default-invoiceDate = nu. Tomma → store
 * genererar id / sätter dueDate null.
 */
function invoiceMeta(input: { id?: string | undefined; invoiceDate?: string | undefined; dueDate?: string | undefined }): Partial<{ id: ReturnType<typeof asId<"InvoiceId">>; invoiceDate: Date; dueDate: Date }> {
  return omitUndefined({
    id: input.id ? asId<"InvoiceId">(input.id) : undefined,
    invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
  });
}

export const billingRunRouter = router({
  list: orgProcedure
    .input(z.object({ matterId: matterIdSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.repos.billingRuns.listForOrg(ctx.orgId, input.matterId);
      return { runs };
    }),

  byId: orgProcedure
    .input(z.object({ id: billingRunIdSchema }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.repos.billingRuns.getByIdInOrg(input.id, ctx.orgId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Faktureringshändelsen finns inte." });
      return run;
    }),

  /**
   * Avdragsmedvetet fakturaförslag (#397): vilka tids-/utläggsposter är
   * ofakturerade (ej frysta) i ärendet, deras sammanlagda upparbetade värde,
   * och summan av tidigare aconto-fakturor. Klienten beräknar aconto-beloppet
   * = %-sats × workValueOre − priorAccontoSumOre och visar förslaget. Org-scopat.
   */
  proposal: orgProcedure
    .input(z.object({ matterId: matterIdSchema }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
      const te = await ctx.repos.timeEntries.listUnfrozenForMatter(input.matterId);
      const ex = await ctx.repos.expenses.listUnfrozenForMatter(input.matterId);
      const priorAccontoSumOre = await sumPriorAccontos(ctx.repos, input.matterId);
      return buildProposal(te, ex, priorAccontoSumOre);
    }),

  /**
   * Fakturaspecifikation (#856): itemiserade tids-/utläggsrader KOPPLADE till
   * fakturan (via `invoiceId`) + avdragna aconto-fakturor + summering. Driver
   * faktura-DOKUMENTET (mallen). En ren aconto-faktura utan länkat arbete får
   * tomma rader (aconton specificeras inte).
   */
  invoiceSpecification: orgProcedure
    .input(z.object({ matterId: matterIdSchema, invoiceId: invoiceIdSchema }))
    .query(async ({ ctx, input }): Promise<InvoiceSpecification> => {
      const invoice = await ctx.repos.invoices.getByIdInOrg(input.invoiceId, ctx.orgId);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Fakturan finns inte." });
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
      const rateOre = await currentArvodeRateOre(ctx.repos, ctx.orgId, matter);
      const [te, ex, deductions] = await Promise.all([
        ctx.repos.timeEntries.listByInvoice(input.invoiceId),
        ctx.repos.expenses.listByInvoice(input.invoiceId),
        fetchSpecDeductions(ctx.repos, ctx.orgId, input.invoiceId),
      ]);
      return buildInvoiceSpecification({
        timeLines: specTimeLines(matter.paymentMethod, rateOre, te),
        expenseLines: specExpenseLines(ex),
        deductions, payableOre: invoice.amount,
      });
    }),

  createAcconto: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      recipient: billingRunRecipientSchema.default("KLIENT"),
      clientShareBips: z.number().int().min(0).max(10000),
      amountOre: z.number().int().nonnegative(),
      // Valfri paritet med legacy (demo/fixtures): klient-id + datum.
      id: invoiceIdSchema.optional(),
      invoiceDate: z.string().optional(),
      dueDate: z.string().optional(),
      notes: z.string().nullish(),
      /** Valfri nedbrytning (#880) — simuleringen skickar det upparbetade arbetet
       *  (tidsspec) så klienten ser vad acontot avser. Utelämnas → default nedan. */
      settlementBreakdown: settlementBreakdownSchema.nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertFlowAction(tx, ctx.orgId, input.matterId, "ACCONTO");
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        // #397: dra av tidigare aconton i det FÖRESLAGNA beloppet —
        // belopp = %-sats × upparbetat − Σ tidigare aconto-fakturor.
        const priorAccontoSumOre = await sumPriorAccontos(tx, input.matterId);
        const proposedOre = proposedAccontoOre(value, input.clientShareBips, priorAccontoSumOre);
        // Acconto är ett brutto-förskott på arvode (25 % moms ingår, #782).
        const accontoNetOre = splitVat({ amount: input.amountOre, vatRate: DEFAULT_VAT_RATE, vatIncluded: true }).exclVat;
        const accontoVatOre = input.amountOre - accontoNetOre;
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: input.amountOre, vatOre: accontoVatOre,
          vatBreakdown: [{ kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: accontoNetOre, vatOre: accontoVatOre }],
          // Nedbrytning (#878/#880): anroparen (simuleringen) skickar en spec med det
          // upparbetade arbetet så klienten ser vad acontot avser; annars en enkel default.
          settlementBreakdown: input.settlementBreakdown ?? {
            timeLines: [],
            rows: [
              { label: `Klientens andel ${input.clientShareBips / 100} % av upparbetat arbete (exkl moms)`, amountOre: accontoNetOre, kind: "add" },
              { label: "Moms 25 %", amountOre: accontoVatOre, kind: "add" },
            ],
            totalLabel: "Att betala (inkl moms)", totalOre: input.amountOre,
          },
          invoiceType: "ACCONTO", status: "DRAFT",
          ...(await invoiceNumbering(tx, ctx.orgId, input.recipient)),
          ...invoiceMeta(input), notes: input.notes,
        });
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "ACCONTO", recipient: input.recipient,
          status: "SENT", workValueOreAtRun: value, clientShareBips: input.clientShareBips,
          proposedAmountOre: proposedOre, amountOre: input.amountOre,
          invoiceId: invoice.id, deductedBillingRunIds: [],
          periodTo: new Date(), notes: input.notes,
        });
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),

  createFinal: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      recipient: billingRunRecipientSchema,
      deductedBillingRunIds: z.array(billingRunIdSchema).default([]),
      // Per-post-val (#734): anges → fakturera/frys ENBART dessa; utelämnas → allt ofryst.
      timeEntryIds: z.array(timeEntryIdSchema).optional(),
      expenseIds: z.array(expenseIdSchema).optional(),
      // Valfri paritet med legacy (demo/fixtures): klient-id + datum.
      id: invoiceIdSchema.optional(),
      invoiceDate: z.string().optional(),
      dueDate: z.string().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertFlowAction(tx, ctx.orgId, input.matterId, "FINAL");
        const { work, selected } = await resolveFinalWork(tx, input.matterId, input.timeEntryIds, input.expenseIds);
        // Brutto = arvode inkl. 25 % moms + utlägg (#782).
        const grossValue = invoiceGrossOre(work);
        const deductedRuns = await fetchDeductedAccontoRuns(tx, input.matterId, input.deductedBillingRunIds);
        const deductionOre = deductedRuns.reduce((sum, r) => sum + (r.amountOre ?? 0), 0);
        const finalAmount = Math.max(0, grossValue - deductionOre);
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: finalAmount, vatOre: invoiceVatOre(work),
          vatBreakdown: invoiceVatBreakdown(work),
          invoiceType: "FINAL", status: "DRAFT",
          ...(await invoiceNumbering(tx, ctx.orgId, input.recipient)),
          ...invoiceMeta(input), notes: input.notes,
        });
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "FINAL", recipient: input.recipient,
          status: "SENT", workValueOreAtRun: grossValue,
          proposedAmountOre: grossValue, amountOre: finalAmount,
          invoiceId: invoice.id, deductedBillingRunIds: input.deductedBillingRunIds,
          periodTo: new Date(), notes: input.notes,
        });
        await freezeSelectedWork(tx, input.matterId, work, selected, run.id);
        // Länka posterna + acconto-avdrag → slutfaktura-vyn visar rätt arvode/utlägg (#728).
        await linkFinalInvoice(tx, invoice.id, work, accontoInvoiceIds(deductedRuns));
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),

  createKostnadsrakning: orgProcedure
    .input(z.object({ matterId: matterIdSchema, notes: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertFlowAction(tx, ctx.orgId, input.matterId, "KOSTNADSRAKNING");
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const matter = await tx.matters.getByIdInOrg(input.matterId, ctx.orgId);
        if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
        // Rättshjälp värderas på timkostnadsnormen (#839) — staten ersätter inte
        // byråns privata timtaxa. Övriga (offentligt uppdrag/taxa): arvode inkl moms
        // + utlägg som tidigare. Brutto matchar kostnadsräkningens PDF (#782).
        const grossValue = matter.paymentMethod === "RATTSHJALP"
          ? rattshjalpKrGrossOre(work, new Date()) // #891: retroaktiv norm per slutregleringsdatum
          : invoiceGrossOre(work);
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
          status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD", workValueOreAtRun: grossValue,
          reference: await nextKrReference(tx, ctx.orgId),
          proposedAmountOre: grossValue, amountOre: grossValue,
          invoiceId: null, deductedBillingRunIds: [],
          periodTo: new Date(), notes: input.notes,
        });
        // Kostnadsräkningen ÄR inskicket — frys arbetet direkt (#806) så det
        // lämnar "Upparbetat ofakturerat". Dom/slutreglering läser raderna via
        // körningen (fetchWorkByRun), inte som ofryst.
        await freezeWork(tx, input.matterId, run.id);
        return { run };
      });
    }),

  /**
   * Registrera domstolens beslut PÅ kostnadsräkningen (#828): dömt belopp +
   * ev. prutning. INSKICKAD → BESLUTAD (tingsrätten); ÖVERKLAGAD → BESLUTAD
   * slutgiltigt (hovrätten). Skapar INGEN faktura — det är ett separat steg.
   */
  recordKostnadsrakningBeslut: orgProcedure
    .input(z.object({
      billingRunId: billingRunIdSchema,
      awardedOre: z.number().int().nonnegative(),
      prutningOre: z.number().int().nonpositive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const run = await assertKostnadsrakning(tx, input.billingRunId, ctx.orgId);
        const state = krStateOf(run);
        const action: KostnadsrakningAction = state.status === "OVERKLAGAD" ? "REGISTRERA_HOVRATT_BESLUT" : "REGISTRERA_BESLUT";
        const next = applyKrTransition(state, action);
        const updated = await tx.billingRuns.update(run.id, {
          kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt,
          awardedOre: input.awardedOre, prutningOre: input.prutningOre ?? null,
        });
        return { run: updated };
      });
    }),

  /**
   * Överklaga prutningen på en kostnadsräkning (#828): BESLUTAD → ÖVERKLAGAD.
   * Inlagan (Word) bifogas som dokument (steg 4). Ingen ny KR — hovrättens beslut
   * registreras sedan på SAMMA körning via recordKostnadsrakningBeslut.
   */
  appealKostnadsrakning: orgProcedure
    .input(z.object({ billingRunId: billingRunIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const run = await assertKostnadsrakning(tx, input.billingRunId, ctx.orgId);
        const next = applyKrTransition(krStateOf(run), "OVERKLAGA");
        const updated = await tx.billingRuns.update(run.id, { kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt });
        return { run: updated };
      });
    }),

  /**
   * Prutnings-/självrisk-fördelning (#800): värderar om arbetet på DET DÅ
   * GÄLLANDE timarvodet (rättshjälp = timkostnadsnorm; rättsskydd = ansvariga
   * juristens aktuella timtaxa) och delar upp i klient/betalare/byrå-förlust.
   * Read-only — driver UIt; faktiska fakturorna skapas i settlement-flödet.
   */
  coverageSplit: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      /** Rättshjälp: domens beviljade belopp (öre). */
      awardedOre: z.number().int().nonnegative().optional(),
      /** Rättsskydd: försäkringsbolagets prutning (öre, ur brevet). */
      insurerPrutningOre: z.number().int().nonnegative().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const matter = await ctx.repos.matters.getByIdInOrg(input.matterId, ctx.orgId);
      if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
      // Använd SAMMA arbets-källa som settleCoverage (resolveSettlementWork): finns
      // en kostnadsräkning är raderna FRYSTA mot den → fetchUnfrozenWork ger 0 (#849).
      // Då matchar förhandsvisningen exakt det som bokas (arvode + utlägg).
      const { work } = await resolveSettlementWork(ctx.repos, ctx.orgId, input.matterId);
      const billableMinutes = work.timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.minutes, 0);
      const currentRateOre = await currentArvodeRateOre(ctx.repos, ctx.orgId, matter);
      const baseMinutes = coverageBaseMinutes(matter.paymentMethod, billableMinutes);
      const totalOre = Math.round((baseMinutes / 60) * currentRateOre);
      // Utlägg bokas på betalaren i settlement-flödet (coverageInvoiceLines) →
      // måste med i förhandsvisningen (#849). Både netto OCH brutto returneras:
      // utläggen har BLANDADE momssatser (6/12/25 %), så bruttot kan inte räknas
      // ur nettot med en platt sats — då blir totalen fel (#850).
      const expensesNetOre = expenseNetOre(work);
      const expensesGrossOre = expenseGrossOre(work);
      const split = computeCoverageSplit({
        method: matter.paymentMethod,
        totalOre,
        clientShareBips: matter.clientShareBips ?? 0,
        ...(input.awardedOre != null ? { awardedOre: input.awardedOre } : {}),
        ...(input.insurerPrutningOre != null ? { insurerPrutningOre: input.insurerPrutningOre } : {}),
        ...rattsskyddCoverage(matter, work.timeEntries, currentRateOre),
      });
      return { ...split, totalOre, expensesNetOre, expensesGrossOre, currentRateOre, billableMinutes };
    }),

  setVerdict: orgProcedure
    .input(z.object({ billingRunId: billingRunIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const run = await assertKostnadsrakning(tx, input.billingRunId, ctx.orgId);
        // Faktura skapas EFTER beslutet (#828): KR:n måste vara BESLUTAD; prutningen
        // läses från KR:ns registrerade beslut, inte som input.
        if (run.kostnadsrakningStatus !== "BESLUTAD") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Registrera domstolens beslut innan du skapar fakturan." });
        }
        const prutningOre = run.prutningOre ?? 0;
        const finalAmount = Math.max(0, run.workValueOreAtRun + prutningOre);
        let prutningExpenseId: ExpenseId | undefined;
        if (prutningOre < 0) {
          const prutning = await tx.expenses.create({
            matterId: run.matterId, userId: ctx.user.id, date: new Date(),
            amount: prutningOre, description: "Prutning enligt dom",
            billable: true, vatRate: 0, vatIncluded: false, kind: "PRUTNING",
          });
          prutningExpenseId = prutning.id;
        }
        // Posterna frystes redan vid kostnadsräkningens inskick (#806) → läs dem
        // via körningen. PRUTNING (nyss skapad) länkas separat nedan.
        const work = await fetchWorkByRun(tx, run.id);
        const invoice = await tx.invoices.create({
          matterId: run.matterId, amount: finalAmount,
          invoiceType: "FINAL", status: "DRAFT",
          // DOMSTOL → F-nummer (samma format som övriga, #889) men ingen OCR.
          ...(await invoiceNumbering(tx, ctx.orgId, "DOMSTOL")),
          invoiceDate: new Date(),
        });
        const next = applyKrTransition(krStateOf(run), "SKAPA_FAKTURA");
        await tx.billingRuns.update(run.id, {
          status: "SENT", invoiceId: invoice.id, amountOre: finalAmount,
          kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt,
        });
        await freezeWork(tx, run.matterId, run.id);
        // Länka poster + PRUTNING-utlägget → kostnadsräknings-vyn visar uppdelning
        // och totalen (arvode + utlägg − prutning) reconciler mot beloppet (#732).
        await linkFinalInvoice(tx, invoice.id, work, []);
        if (prutningExpenseId) await tx.expenses.flagBilled([prutningExpenseId], invoice.id);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),

  /**
   * Settlement (#800/#801) för rättsskydd & rättshjälp: betalaren har svarat
   * (försäkringsbrev med prutning / dom med beviljat belopp). Arbetet värderas
   * om på AKTUELLT timarvode, delas upp via `computeCoverageSplit`, och bokas:
   *   - KLIENT-faktura (självrisk + ev. prutning, minus tidigare aconton)
   *   - BETALAR-faktura (försäkring/stat) + utlägg
   *   - byrå-förlust (rättshjälp) som icke-debiterbar PRUTNING-post
   * Allt arbete fryses. Moms enligt #782 (arvode 25 %, utlägg per sats).
   */
  settleCoverage: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      payerRecipient: billingRunRecipientSchema,
      awardedOre: z.number().int().nonnegative().optional(),
      insurerPrutningOre: z.number().int().nonnegative().optional(),
      deductedBillingRunIds: z.array(billingRunIdSchema).default([]),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertFlowAction(tx, ctx.orgId, input.matterId, "SETTLE");
        const matter = await tx.matters.getByIdInOrg(input.matterId, ctx.orgId);
        if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
        if (matter.paymentMethod !== "RATTSSKYDD" && matter.paymentMethod !== "RATTSHJALP") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Settlement gäller bara rättsskydd/rättshjälp." });
        }
        const { work, krRun } = await resolveSettlementWork(tx, ctx.orgId, input.matterId);
        // Finns en kostnadsräkning måste den vara BESLUTAD först — fakturan skapas
        // EFTER domstolens beslut (#828). Domsbeloppet läses då från KR:n, inte input.
        const awardedOre = resolveAwardedOre(krRun, input.awardedOre);
        const rateOre = await currentArvodeRateOre(tx, ctx.orgId, matter);
        // #891: rättshjälp räknas om på slutregleringsårets normer (retroaktiv höjning
        // över årsskifte + tidsspillan på egen norm); övriga metoder → platt rate.
        const settleDate = new Date();
        const totalArvodeNet = settlementArvodeNet(matter.paymentMethod, work, settleDate, rateOre);
        const split = computeCoverageSplit({
          method: matter.paymentMethod, totalOre: totalArvodeNet, clientShareBips: matter.clientShareBips ?? 0,
          awardedOre, insurerPrutningOre: input.insurerPrutningOre ?? null,
          ...rattsskyddCoverage(matter, work.timeEntries, rateOre),
        });
        const { clientLines, payerLines } = coverageInvoiceLines(split, work);

        // Klient: självrisk (+ ev. prutning), moms 25 %, minus tidigare aconton.
        // Auto-dra av ALLA skickade klient-aconton (#856): de har redan betalats,
        // så slutfakturan reduceras med dem (utöver ev. explicit valda).
        const sentAccontoIds = (await tx.billingRuns.listAccontoSent(input.matterId)).map((r) => r.id);
        const deductIds = [...new Set([...input.deductedBillingRunIds, ...sentAccontoIds])];
        const clientGross = grossOreOf(clientLines);
        const deductedRuns = await fetchDeductedAccontoRuns(tx, input.matterId, deductIds);
        const deductionOre = deductedRuns.reduce((s, r) => s + (r.amountOre ?? 0), 0);
        const clientAmount = Math.max(0, clientGross - deductionOre);
        const payerGross = grossOreOf(payerLines);

        // Bygg slutregleringsvyerna FÖRE fakturorna (#876) så de kan persisteras på
        // respektive faktura → EN källa för både dokumentet och Slutfaktura-sidan.
        const breakdown = await buildSettlementBreakdown(tx, ctx.orgId, {
          clientShareBips: matter.clientShareBips ?? 0, totalArvodeNet,
          split, work, payerGross, clientPayable: clientAmount,
          method: matter.paymentMethod, rateOre, settleDate, deductedRuns,
        });
        const { clientView, payerView } = buildSettlementViews(breakdown, matter.paymentMethod);

        // Klientfakturan: EN faktura (FINAL om skyldig, CREDIT om överbetald) — aldrig 0.00 (#878).
        const { invoice: clientInvoice, creditInvoice } = await createClientSettlementInvoice(tx, ctx, ctx.orgId, {
          matterId: input.matterId, clientGrossOre: clientGross, deductionOre, clientLines, clientView,
          method: matter.paymentMethod, notes: input.notes,
        });
        const payerInvoice = await tx.invoices.create({
          matterId: input.matterId, amount: payerGross, vatOre: vatOreOf(payerLines), vatBreakdown: payerLines,
          settlementBreakdown: payerView,
          invoiceType: "FINAL", status: "DRAFT", ...(await invoiceNumbering(tx, ctx.orgId, input.payerRecipient)), invoiceDate: new Date(), notes: input.notes,
        });
        await bookFirmLoss(tx, ctx.user.id, input.matterId, split.firmLossOre);
        const clientRun = await tx.billingRuns.create({
          matterId: input.matterId, type: "FINAL", recipient: "KLIENT", status: "SENT",
          workValueOreAtRun: clientGross, proposedAmountOre: clientGross, amountOre: clientInvoice.amount,
          invoiceId: clientInvoice.id, deductedBillingRunIds: deductIds, periodTo: new Date(), notes: input.notes,
        });
        const payerRun = await bookPayerRun(tx, {
          matterId: input.matterId, payerRecipient: input.payerRecipient, payerInvoiceId: payerInvoice.id,
          payerGross, notes: input.notes, krRun,
        });
        await linkSettlementInvoices(tx, { work, payerInvoiceId: payerInvoice.id, clientInvoiceId: clientInvoice.id, deductedRuns });
        // KR:n förblir en distinkt kostnadsräkning (med sitt dokument/beslut) —
        // konsumeras EJ in i fakturan; markeras FAKTURERAD (#828).
        if (krRun) {
          const next = applyKrTransition(krStateOf(krRun), "SKAPA_FAKTURA");
          await tx.billingRuns.update(krRun.id, { status: "SENT", kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt });
        }
        await emit.invoiceCreated(ctx, payerInvoice); // klientfakturan emittas i helpern
        // `creditInvoice` = klientfakturan när den blev en CREDIT (överfakturerad), annars null.
        return { split, clientInvoice, payerInvoice, creditInvoice, clientRun, payerRun, breakdown };
      });
    }),
});

/**
 * Validera + hämta de avdragna ACCONTO-körningarna. Säkerhet (#60): de måste
 * tillhöra SAMMA ärende och vara ACCONTO-körningar — annars kunde en FINAL dra
 * av främmande/fel-typade billing-runs och förvanska beloppet. Returnerar
 * körningarna (anroparen summerar `amountOre` + plockar deras `invoiceId`).
 */
async function fetchDeductedAccontoRuns(
  repos: Repositories,
  matterId: MatterId,
  ids: ReadonlyArray<BillingRunId>,
): Promise<BillingRun[]> {
  if (ids.length === 0) return [];
  const runs = await repos.billingRuns.listAccontoByIds(matterId, [...ids]);
  if (runs.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Någon avdragspost tillhör inte detta ärende eller är ingen ACCONTO-körning.",
    });
  }
  return runs;
}

/** Acconto-fakturornas id ur avdragna körningar (för acconto_deductions-raderna). */
function accontoInvoiceIds(runs: ReadonlyArray<BillingRun>): InvoiceId[] {
  return runs.map((r) => r.invoiceId).filter((id): id is NonNullable<typeof id> => id != null);
}
