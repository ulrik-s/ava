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
import { TIMKOSTNADSNORM_FTAX_ORE_PER_H, TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H } from "@/lib/shared/brottmalstaxa";
import { computeCoverageSplit, partitionRattsskyddMinutes, type CoverageSplit } from "@/lib/shared/coverage-billing";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import { applyKrAction, type KostnadsrakningAction, type KostnadsrakningState, type KostnadsrakningStatus } from "@/lib/shared/kostnadsrakning-flow";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { RADGIVNING_MINUTES } from "@/lib/shared/rattshjalp";
import type { BillingRun } from "@/lib/shared/schemas/billing";
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
import { splitVat, DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { emit } from "../events/emit";
import type { BillingRunDetailRow, BillingRunListRow } from "../repositories/billing-run-repository";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";

interface UnfrozenWork {
  timeEntries: Array<{ id: TimeEntryId; minutes: number; hourlyRate: number; billable: boolean; date: Date | string }>;
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
    return matter.taxaHasFTax === false ? TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H : TIMKOSTNADSNORM_FTAX_ORE_PER_H;
  }
  if (!matter.responsibleLawyerId) return 0;
  const lawyer = await repos.users.getByIdInOrg(matter.responsibleLawyerId, orgId);
  return lawyer?.hourlyRate ?? 0;
}

/** Faktura-rader (moms-breakdown) för klient- resp. betalar-fakturan ur en
 *  prutnings-/självrisk-uppdelning (#801). Klient = sin arvode-del; betalare =
 *  sin arvode-del + utläggen. */
function coverageInvoiceLines(split: CoverageSplit, work: UnfrozenWork): { clientLines: VatBreakdownLine[]; payerLines: VatBreakdownLine[] } {
  const clientArvode = arvodeLine(split.clientOre);
  const payerArvode = arvodeLine(split.payerOre);
  return {
    clientLines: clientArvode ? [clientArvode] : [],
    payerLines: [...(payerArvode ? [payerArvode] : []), ...expenseBreakdownLines(work)],
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
      timeEntries: selTime.map((t) => ({ id: t.id, minutes: t.minutes, hourlyRate: t.user.hourlyRate ?? 0, billable: t.billable, date: t.date })),
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
 * Tilldela fakturanummer + OCR (ADR 0012) — klient-/försäkringsfakturor får
 * `F-YYYY-NNNN` + härledd OCR; kostnadsräkningar till DOMSTOL får varken nummer
 * eller OCR (domstolen betalar inte via OCR). Matchar legacy `invoice.createFinal`
 * så en billing-run-faktura blir likvärdig. Tomt objekt → faktura utan nummer.
 */
async function invoiceNumbering(
  repos: Repositories,
  orgId: OrganizationId,
  recipient: BillingRunRecipient,
): Promise<{ invoiceNumber: string; ocrReference: string | null } | Record<string, never>> {
  if (recipient === "DOMSTOL") return {};
  const invoiceNumber = await repos.invoices.nextInvoiceNumber(orgId);
  return { invoiceNumber, ocrReference: ocrFromInvoiceNumber(invoiceNumber) };
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
        // Brutto = arvode inkl. 25 % moms + utlägg (#782) — matchar kostnadsräkningens PDF.
        const grossValue = invoiceGrossOre(work);
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
          status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD", workValueOreAtRun: grossValue,
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
      const { billableMinutes } = await ctx.repos.timeEntries.coverageUsageForMatter(input.matterId);
      const entries = await ctx.repos.timeEntries.listUnfrozenForMatter(input.matterId);
      const currentRateOre = await currentArvodeRateOre(ctx.repos, ctx.orgId, matter);
      const baseMinutes = coverageBaseMinutes(matter.paymentMethod, billableMinutes);
      const totalOre = Math.round((baseMinutes / 60) * currentRateOre);
      const split = computeCoverageSplit({
        method: matter.paymentMethod,
        totalOre,
        clientShareBips: matter.clientShareBips ?? 0,
        ...(input.awardedOre != null ? { awardedOre: input.awardedOre } : {}),
        ...(input.insurerPrutningOre != null ? { insurerPrutningOre: input.insurerPrutningOre } : {}),
        ...rattsskyddCoverage(matter, entries, currentRateOre),
      });
      return { ...split, totalOre, currentRateOre, billableMinutes };
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
          invoiceType: "FINAL", status: "DRAFT", // DOMSTOL → inget nummer/OCR (ADR 0012)
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
        const billableMinutes = work.timeEntries.filter((t) => t.billable).reduce((s, t) => s + t.minutes, 0);
        const rateOre = await currentArvodeRateOre(tx, ctx.orgId, matter);
        const baseMinutes = coverageBaseMinutes(matter.paymentMethod, billableMinutes);
        const totalArvodeNet = Math.round((baseMinutes / 60) * rateOre);
        const split = computeCoverageSplit({
          method: matter.paymentMethod, totalOre: totalArvodeNet, clientShareBips: matter.clientShareBips ?? 0,
          awardedOre, insurerPrutningOre: input.insurerPrutningOre ?? null,
          ...rattsskyddCoverage(matter, work.timeEntries, rateOre),
        });
        const { clientLines, payerLines } = coverageInvoiceLines(split, work);

        // Klient: självrisk (+ ev. prutning), moms 25 %, minus tidigare aconton.
        const clientGross = grossOreOf(clientLines);
        const deductedRuns = await fetchDeductedAccontoRuns(tx, input.matterId, input.deductedBillingRunIds);
        const deductionOre = deductedRuns.reduce((s, r) => s + (r.amountOre ?? 0), 0);
        const clientAmount = Math.max(0, clientGross - deductionOre);
        const payerGross = grossOreOf(payerLines);

        const clientInvoice = await tx.invoices.create({
          matterId: input.matterId, amount: clientAmount, vatOre: vatOreOf(clientLines), vatBreakdown: clientLines,
          invoiceType: "FINAL", status: "DRAFT", ...(await invoiceNumbering(tx, ctx.orgId, "KLIENT")), invoiceDate: new Date(), notes: input.notes,
        });
        const payerInvoice = await tx.invoices.create({
          matterId: input.matterId, amount: payerGross, vatOre: vatOreOf(payerLines), vatBreakdown: payerLines,
          invoiceType: "FINAL", status: "DRAFT", ...(await invoiceNumbering(tx, ctx.orgId, input.payerRecipient)), invoiceDate: new Date(), notes: input.notes,
        });
        await bookFirmLoss(tx, ctx.user.id, input.matterId, split.firmLossOre);
        const clientRun = await tx.billingRuns.create({
          matterId: input.matterId, type: "FINAL", recipient: "KLIENT", status: "SENT",
          workValueOreAtRun: clientGross, proposedAmountOre: clientGross, amountOre: clientAmount,
          invoiceId: clientInvoice.id, deductedBillingRunIds: input.deductedBillingRunIds, periodTo: new Date(), notes: input.notes,
        });
        const payerRun = await bookPayerRun(tx, {
          matterId: input.matterId, payerRecipient: input.payerRecipient, payerInvoiceId: payerInvoice.id,
          payerGross, notes: input.notes, krRun,
        });
        // KR:n förblir en distinkt kostnadsräkning (med sitt dokument/beslut) —
        // konsumeras EJ in i fakturan; markeras FAKTURERAD (#828).
        if (krRun) {
          const next = applyKrTransition(krStateOf(krRun), "SKAPA_FAKTURA");
          await tx.billingRuns.update(krRun.id, { status: "SENT", kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt });
        }
        await emit.invoiceCreated(ctx, clientInvoice);
        await emit.invoiceCreated(ctx, payerInvoice);
        return { split, clientInvoice, payerInvoice, clientRun, payerRun };
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
