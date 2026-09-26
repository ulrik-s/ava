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
import { deductAcconto } from "@/lib/shared/acconto-vat";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { assertBillingTransition, type BillingActionType } from "@/lib/shared/billing-flow";
import { buildProposal, proposedAccontoOre } from "@/lib/shared/billing-proposal";
import {
  expenseGrossOre,
  expenseNetOre, grossOreOf, invoiceGrossOre, invoiceVatBreakdown, krGrossOre, matterArvodeNet, netOreOf,
  settlementArvodeNet, vatOreOf,
  type UnfrozenWork,
} from "@/lib/shared/billing-work-value";
import { TIMKOSTNADSNORM_FTAX_ORE_PER_H } from "@/lib/shared/brottmalstaxa";
import {
  computeCoverageSplit, coverageInvoiceLines, rattsskyddCoverage, resolveAward,
  type CoverageSplit,
} from "@/lib/shared/coverage-billing";
import { resolveHourlyRate, type LevelRates } from "@/lib/shared/hourly-rate";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import {
  buildInvoiceSpecification, specExpenseLines, specTimeLines,
  type InvoiceSpecification, type SpecDeduction,
} from "@/lib/shared/invoice-specification";
import { applyKrAction, canVoidKostnadsrakning, krStateOf, type KostnadsrakningAction, type KostnadsrakningState } from "@/lib/shared/kostnadsrakning-flow";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { isRadgivningInvoiced } from "@/lib/shared/rattshjalp";
import { settlementBreakdownSchema, type BillingRun, type Invoice } from "@/lib/shared/schemas/billing";
import { billingRunRecipientSchema, type BillingRunRecipient, type PaymentMethod } from "@/lib/shared/schemas/enums";
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
import {
  buildClientArvodeLines, buildCreditView, buildSettlementViews, creditPayload, radgivningOre,
  type SettlementBreakdown, type SettlementRowKind, type SettlementView,
} from "@/lib/shared/settlement-view";
import { splitVat, DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { emit, type EmitCtx } from "../events/emit";
import type { BillingRunDetailRow, BillingRunListRow } from "../repositories/billing-run-repository";
import { nextInvoiceNumberFrom } from "../repositories/invoice-repository";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";











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











/**
 * Rättshjälpens KR-anspråk till domstol, brutto (#839/#891): arbetet värderas på
 * TIMKOSTNADSNORMEN (staten ersätter bara normen, ej byråns taxa), tidsspillan på
 * tidsspillan-normen; den låsta rådgivningstimmen ingår inte. Utlägg ersätts brutto.
 */






/**
 * Det DÅ GÄLLANDE timarvodet (öre/tim) som arbetet ska värderas om på vid
 * fakturering (#800): rättshjälp → timkostnadsnormen (F-skatt-variant);
 * rättsskydd m.fl. → AKTUELLT timarvode (ej snapshot) genom ärende → ansvarig
 * jurist → byrå (#1206).
 */
async function currentArvodeRateOre(
  repos: Repositories,
  orgId: OrganizationId,
  matter: {
    paymentMethod: string; taxaHasFTax?: boolean | null | undefined;
    responsibleLawyerId?: UserId | null | undefined; hourlyRates?: LevelRates;
  },
): Promise<number> {
  if (matter.paymentMethod === "RATTSHJALP") {
    // Alla advokater har F-skatt (#839) → alltid F-skatt-normen, oberoende av
    // matter.taxaHasFTax (ett brottmåls-taxefält som är meningslöst här).
    return TIMKOSTNADSNORM_FTAX_ORE_PER_H;
  }
  const [lawyer, org] = await Promise.all([
    matter.responsibleLawyerId ? repos.users.getByIdInOrg(matter.responsibleLawyerId, orgId) : null,
    repos.organizations.getById(orgId),
  ]);
  return resolveHourlyRate("ARBETE", { matter: matter.hourlyRates, user: lawyer?.hourlyRates, org: org?.hourlyRates });
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
// Modell + summerings-builder bor i `@/lib/shared/invoice-specification` (#937)
// så faktura-mallen och demo-generatorn kan bygga samma shape (DRY).




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


async function buildSettlementBreakdown(repos: Repositories, orgId: OrganizationId, a: {
  clientShareBips: number; totalArvodeNet: number; split: CoverageSplit; work: UnfrozenWork;
  payerGross: number; clientPayable: number; radgivningInvoiced: boolean; rateOre: number; settleDate: Date | string;
  deductedRuns: ReadonlyArray<{ invoiceId?: InvoiceId | null | undefined }>;
  /** Utläggsrader per part EFTER nedsättning (#943) och ev. 25 %-omrating mot
   *  domstol (#945) — exakt de rader fakturorna bär. */
  clientExpenseLines: VatBreakdownLine[];
  payerExpenseLines: VatBreakdownLine[];
  /** Nedsättningens utläggsdel (netto) — byrån bär den, jfr split.firmLossOre. */
  expenseLossNetOre: number;
  /** Utlägg netto FÖRE domstolens nedsättning — trappans utläggsrad (#947). */
  expensesBaseNetOre: number;
}): Promise<SettlementBreakdown> {
  // Rådgivningstimmen ingår ALDRIG i domstolens arvode (#860/#1205) — den är en
  // låst, redan fakturerad post och finns inte i `work`; den omnämns bara.
  // Utlägg delas per samma andel som arvodet (#878): klientens del + betalarens del.
  const clientExpensesGrossOre = grossOreOf(a.clientExpenseLines);
  const payerExpensesGrossOre = grossOreOf(a.payerExpenseLines);
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
    expensesBaseNetOre: a.expensesBaseNetOre,
    expenseLossNetOre: a.expenseLossNetOre,
    clientExpensesNetOre: netOreOf(a.clientExpenseLines),
    clientExpensesVatOre: vatOreOf(a.clientExpenseLines),
    payerExpensesNetOre: netOreOf(a.payerExpenseLines),
    payerExpensesVatOre: vatOreOf(a.payerExpenseLines),
    sjalvriskNetOre: a.split.clientOre,
    sjalvriskGrossOre: arvodeInclVatOre(a.split.clientOre),
    firmLossNetOre: a.split.firmLossOre,
    prutningGrossOre: arvodeInclVatOre(a.split.firmLossOre),
    payerArvodeNetOre: a.split.payerOre,
    ...radgivningOre(a.radgivningInvoiced, a.rateOre),
    payerPayableOre: a.payerGross,
    clientPayableOre: a.clientPayable,
    clientArvodeLines: buildClientArvodeLines(a.work, a.totalArvodeNet, a.settleDate),
    deductedAccontos,
    ...(a.split.clientParts ? { clientParts: a.split.clientParts } : {}),
  };
}


async function createClientSettlementInvoice(repos: Repositories, ctx: EmitCtx, orgId: OrganizationId, a: {
  matterId: MatterId; clientGrossOre: number; deductionOre: number;
  clientLines: VatBreakdownLine[]; clientView: SettlementView; method: PaymentMethod; invoiceDate?: Date | string; notes: string | null | undefined;
}): Promise<{ invoice: Invoice; creditInvoice: Invoice | null }> {
  const clientNet = a.clientGrossOre - a.deductionOre; // kan vara negativt (överbetald)
  const isCredit = clientNet < 0;
  const feeTerm = a.method === "RATTSHJALP" ? "rättshjälpsavgift" : "självrisk";
  const base = { matterId: a.matterId, amount: clientNet, ...(await invoiceNumbering(repos, orgId, "KLIENT")), invoiceDate: a.invoiceDate ? new Date(a.invoiceDate) : new Date() };
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
        notes: `Rättshjälps-överfakturering: betalda aconton (${(a.deductionOre / 100).toLocaleString("sv-SE")} kr) översteg slutlig ${feeTerm} — mellanskillnaden krediteras klienten.`,
      }
    : {
        ...base, vatOre: vatOreOf(rest.lines), vatBreakdown: rest.lines,
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
      // Postens eget á-pris — samma som ovalda poster (fetchUnfrozenWork): priset
      // sparades på posten vid registrering/kategoribyte (#1206).
      timeEntries: selTime,
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


/** Hämta en KOSTNADSRAKNING-körning org-scopat; kastar om saknad/fel typ. */
async function assertKostnadsrakning(repos: Repositories, billingRunId: BillingRunId, orgId: OrganizationId): Promise<BillingRunDetailRow> {
  const run = await repos.billingRuns.getByIdInOrg(billingRunId, orgId);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Kostnadsräkningen finns inte." });
  if (run.type !== "KOSTNADSRAKNING") throw new TRPCError({ code: "BAD_REQUEST", message: "Åtgärden gäller bara kostnadsräkningar." });
  return run;
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

/** ISO-datum → Date, annars nu (#907) — utbruten så settleCoverage/pruning-handlarna
 *  håller sig ≤8 i komplexitet. */
function toDateOrNow(iso: string | undefined): Date {
  return iso ? new Date(iso) : new Date();
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

/** Applicera en KR-övergång; översätt otillåten övergång till TRPCError. */
function applyKrTransition(state: KostnadsrakningState, action: KostnadsrakningAction): KostnadsrakningState {
  try {
    return applyKrAction(state, action);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Otillåten kostnadsräknings-övergång." });
  }
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
      return buildProposal(te, ex, priorAccontoSumOre, matter);
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
      // Taxan hämtas inte längre ur juristen: varje post värderas på sin kategoris
      // norm för fakturans år (#950), samma regel som slutregleringen använder.
      const [te, ex, deductions] = await Promise.all([
        ctx.repos.timeEntries.listByInvoice(input.invoiceId),
        ctx.repos.expenses.listByInvoice(input.invoiceId),
        fetchSpecDeductions(ctx.repos, ctx.orgId, input.invoiceId),
      ]);
      return buildInvoiceSpecification({
        timeLines: specTimeLines(matter.paymentMethod, te, invoice.invoiceDate ?? new Date()),
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
        const matter = await tx.matters.getByIdInOrg(input.matterId, ctx.orgId);
        if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
        const value = matterArvodeNet(matter, work, new Date()) + expenseNetOre(work);
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
        // #968 (modell A): acontona har REDAN bokfört sin intäkt och sin moms.
        // Slutfakturan bär bara resten — annars bokförs acontot två gånger.
        const rest = deductAcconto(invoiceVatBreakdown(work), deductionOre);
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: finalAmount, vatOre: vatOreOf(rest.lines),
          vatBreakdown: rest.lines,
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
        // Domstolen ersätter enligt Domstolsverkets normer — rättshjälp (#839)
        // och offentligt uppdrag (#1003) värderas per kategori-norm på yrkande-
        // dagen (retroaktiv norm, #891), inte på posternas egna á-priser.
        // TAXA-ÄRENDEN undantas: där styr brottmålstaxan arvodet och posterna är
        // informativa — en omvärdering per timnorm vore ett yrkande taxan aldrig
        // ger. Deras körning behåller posternas värde (status quo; jfr #1003).
        // Brutto matchar kostnadsräkningens PDF (#782).
        const krArvodeNet = matterArvodeNet(matter, work, new Date());
        const grossValue = krGrossOre(work, krArvodeNet);
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
   * Ångra en kostnadsräkning (#1121) — t.ex. skapad av misstag eller innan allt
   * arbete registrerats. Bara före domstolens beslut (`canVoidKostnadsrakning`).
   * Låser upp EXAKT de poster körningen frös, och annullerar körningen (VOIDED)
   * så ärendet lämnar "väntar på dom" och en ny kostnadsräkning kan skapas.
   */
  voidKostnadsrakning: orgProcedure
    .input(z.object({ billingRunId: billingRunIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const run = await assertKostnadsrakning(tx, input.billingRunId, ctx.orgId);
        if (!canVoidKostnadsrakning(run)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Kostnadsräkningen kan bara ångras innan domstolen har beslutat och ingen faktura skapats.",
          });
        }
        await tx.timeEntries.unfreezeByBillingRun(run.id);
        await tx.expenses.unfreezeByBillingRun(run.id);
        const updated = await tx.billingRuns.update(run.id, { status: "VOIDED" });
        return { run: updated };
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
      // Förhandsvisningen måste räkna EXAKT som slutregleringen (#950) — annars
      // visar dialogen ett annat belopp än den faktura som sedan skapas.
      const totalOre = settlementArvodeNet(matter.paymentMethod, work, new Date());
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
        ...rattsskyddCoverage(matter, work.timeEntries, new Date()),
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
      /** Fakturadatum (demo/fixtures) — annars idag. Även slutregleringsårets norm (#907). */
      invoiceDate: z.string().optional(),
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
        const settleDate = toDateOrNow(input.invoiceDate);
        const totalArvodeNet = settlementArvodeNet(matter.paymentMethod, work, settleDate);
        // Domstolens beslut avser det kostnadsräkningen YRKADE: arvode + utlägg,
        // inkl moms (#943). Härled nedsättningen som en andel av hela anspråket och
        // skala BÅDE arvodet och utläggsraderna med den — annars klampas nedsättningen
        // bort (beviljat brutto > arvode netto) och byrån fakturerar som om domstolen
        // beviljat allt. Rättsskydd rör inte den här vägen: där är bolagets prutning en
        // egen händelse som klienten bär (`recordInsurerPruning`).
        const award = resolveAward(matter.paymentMethod, totalArvodeNet, work, awardedOre);
        const { expenseLines, expenseLossNetOre, expensesBaseNetOre } = award;
        const split = computeCoverageSplit({
          method: matter.paymentMethod, totalOre: totalArvodeNet, clientShareBips: matter.clientShareBips ?? 0,
          awardedOre: award.awardedArvodeNetOre,
          insurerPrutningOre: input.insurerPrutningOre ?? null,
          ...rattsskyddCoverage(matter, work.timeEntries, settleDate),
        });
        const { clientLines, payerLines, clientExpenseLines, payerExpenseLines } =
          coverageInvoiceLines(split, expenseLines);

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
          radgivningInvoiced: isRadgivningInvoiced(matter), rateOre, settleDate, deductedRuns,
          clientExpenseLines, payerExpenseLines, expenseLossNetOre, expensesBaseNetOre,
        });
        const { clientView, payerView } = buildSettlementViews(breakdown, matter.paymentMethod);

        // Klientfakturan: EN faktura (FINAL om skyldig, CREDIT om överbetald) — aldrig 0.00 (#878).
        const { invoice: clientInvoice, creditInvoice } = await createClientSettlementInvoice(tx, ctx, ctx.orgId, {
          matterId: input.matterId, clientGrossOre: clientGross, deductionOre, clientLines, clientView,
          method: matter.paymentMethod, invoiceDate: settleDate, notes: input.notes,
        });
        const payerInvoice = await tx.invoices.create({
          matterId: input.matterId, amount: payerGross, vatOre: vatOreOf(payerLines), vatBreakdown: payerLines,
          settlementBreakdown: payerView,
          invoiceType: "FINAL", status: "DRAFT", ...(await invoiceNumbering(tx, ctx.orgId, input.payerRecipient)), invoiceDate: settleDate, notes: input.notes,
        });
        await bookFirmLoss(tx, ctx.user.id, input.matterId, split.firmLossOre + expenseLossNetOre);
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

  /**
   * Registrera försäkringsbolagets PRUTNING efter slutregleringen (#905/#952,
   * rättsskydd, flöde B): bolaget ersätter mindre än fakturerat. Prutningen bärs
   * av KLIENTEN — byrån blir hel.
   *
   * INGEN kreditfaktura till försäkringsbolaget. I rättsskydd GÅR fakturan till
   * bolaget men är STÄLLD TILL KLIENTEN: det gick aldrig ut någon faktura *till*
   * bolaget, och därmed finns inget att kreditera dem. Klienten har två fakturor
   * efter slutregleringen — självrisk-fakturan och den som försäkringen betalar —
   * och prutningen ändrar bara FÖRDELNINGEN mellan dem:
   *
   *   försäkringsfakturan  −prutningen (inkl moms)
   *   klientfakturan       +prutningen (inkl moms)
   *
   * Totalen är oförändrad och inga nya fakturor uppstår. Kräver en befintlig
   * FORSAKRING-slutregleringsfaktura + klientens slutregleringsfaktura.
   */
  recordInsurerPruning: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      /** Prutat arvode NETTO (öre) — den del försäkringen inte ersätter. */
      prunedNetOre: z.number().int().positive(),
      /** Bokföringsdatum för omfördelningen (demo/fixtures) — annars idag. */
      invoiceDate: z.string().optional(),
      notes: z.string().nullish(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.repos.transaction(async (tx) => {
        const t = await resolvePruningTargets(tx, ctx.orgId, input.matterId);
        const prunedGross = arvodeInclVatOre(input.prunedNetOre);
        const prunedVat = prunedGross - input.prunedNetOre;
        if (prunedGross > t.payerInvoice.amount) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Prutningen (${prunedGross / 100} kr inkl moms) är större än försäkringsfakturan (${t.payerInvoice.amount / 100} kr).`,
          });
        }
        const when = toDateOrNow(input.invoiceDate);
        const payerInvoice = await tx.invoices.update(t.payerInvoice.id, shiftInvoiceAmount(t.payerInvoice, -input.prunedNetOre, -prunedVat, {
          label: "Avgår försäkringens prutning — faktureras klienten (exkl moms)", kind: "deduct",
        }));
        const clientInvoice = await tx.invoices.update(t.clientInvoice.id, shiftInvoiceAmount(t.clientInvoice, input.prunedNetOre, prunedVat, {
          label: "Försäkringens prutning — bärs av klienten (exkl moms)", kind: "add",
        }));
        // Körningarna följer sina fakturor så rapporter/AR summerar rätt, och
        // prutningen märks på betalar-körningen (`prutningOre`) → UI:t vet att den
        // är registrerad utan att det finns någon CREDIT att leta efter.
        await tx.billingRuns.update(t.payerRun.id, {
          amountOre: payerInvoice.amount, prutningOre: -input.prunedNetOre,
          notes: input.notes ?? `Försäkringens prutning ${input.prunedNetOre / 100} kr (exkl moms) — omfördelad till klientfakturan ${clientInvoice.invoiceNumber ?? ""}`.trim(),
        });
        await tx.billingRuns.update(t.clientRun.id, { amountOre: clientInvoice.amount });
        await emit.invoiceAdjusted(ctx, payerInvoice, "insurer_pruning");
        await emit.invoiceAdjusted(ctx, clientInvoice, "insurer_pruning");
        return { payerInvoice, clientInvoice, prunedGross, adjustedAt: when };
      }),
    ),
});

/** Slutregleringens två fakturor i ett rättsskyddsärende — båda ställda till klienten. */
interface PruningTargets {
  payerRun: BillingRunListRow;
  payerInvoice: Invoice;
  clientRun: BillingRunListRow;
  clientInvoice: Invoice;
}

/**
 * Hitta de två fakturorna prutningen omfördelas mellan (#952). Båda måste finnas:
 * utan försäkringsfakturan finns inget att pruta på, och utan klientfakturan finns
 * ingen att flytta beloppet till (då vore prutningen en ren förlust, vilket den inte
 * är i rättsskydd). Senaste körningen per mottagare vinner om flera finns.
 */
async function resolvePruningTargets(tx: Repositories, orgId: OrganizationId, matterId: MatterId): Promise<PruningTargets> {
  const runs = await tx.billingRuns.listForOrg(orgId, matterId);
  const finals = runs.filter((r) => r.type === "FINAL" && r.invoiceId);
  const payerRun = finals.find((r) => r.recipient === "FORSAKRING");
  if (!payerRun?.invoiceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ingen försäkringsfaktura att pruta på — slutreglera mot försäkringen först." });
  }
  const clientRun = finals.find((r) => r.recipient === "KLIENT");
  if (!clientRun?.invoiceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ingen klientfaktura att omfördela prutningen till — slutreglera ärendet först." });
  }
  const [payerInvoice, clientInvoice] = await Promise.all([
    tx.invoices.getByIdInOrg(payerRun.invoiceId, orgId),
    tx.invoices.getByIdInOrg(clientRun.invoiceId, orgId),
  ]);
  if (!payerInvoice || !clientInvoice) throw new TRPCError({ code: "NOT_FOUND", message: "Slutregleringens fakturor kunde inte läsas." });
  return { payerRun, payerInvoice, clientRun, clientInvoice };
}

/**
 * Flytta ett arvode-belopp till/från en faktura (#952): `amount`, `vatOre`,
 * moms-uppdelningen (arvodets 25 %-rad) och nedbrytningsvyn justeras tillsammans,
 * så fakturan aldrig visar en moms som inte hör till dess belopp. `deltaNet` är
 * signerat (negativt = avgår).
 */
function shiftInvoiceAmount(
  invoice: Invoice, deltaNet: number, deltaVat: number, row: { label: string; kind: SettlementRowKind },
): Partial<Invoice> {
  return {
    amount: invoice.amount + deltaNet + deltaVat,
    vatOre: (invoice.vatOre ?? 0) + deltaVat,
    vatBreakdown: shiftArvodeVatLine(invoice.vatBreakdown ?? [], deltaNet, deltaVat),
    settlementBreakdown: appendBreakdownRow(invoice.settlementBreakdown, row.label, Math.abs(deltaNet), row.kind, deltaNet + deltaVat),
  };
}

/** Justera arvodets 25 %-rad i moms-uppdelningen; saknas den läggs den till. */
function shiftArvodeVatLine(lines: readonly VatBreakdownLine[], deltaNet: number, deltaVat: number): VatBreakdownLine[] {
  const idx = lines.findIndex((l) => l.kind === "arvode" && l.vatRate === DEFAULT_VAT_RATE);
  if (idx < 0) return [...lines, { kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: deltaNet, vatOre: deltaVat }];
  return lines.map((l, i) => (i === idx ? { ...l, netOre: l.netOre + deltaNet, vatOre: l.vatOre + deltaVat } : l));
}

/**
 * Lägg en förklarande rad sist i nedbrytningsvyn och flytta totalen (#952), så
 * fakturadokumentet visar VARFÖR beloppet ändrades. Momsraden får en egen rad
 * eftersom trappan redovisar netto och moms separat.
 */
function appendBreakdownRow(
  view: SettlementView | null | undefined, label: string, netOre: number, kind: SettlementRowKind, deltaGross: number,
): SettlementView {
  const base: SettlementView = view ?? { timeLines: [], rows: [], totalLabel: "Att betala (inkl moms)", totalOre: 0 };
  const vatOre = Math.abs(deltaGross) - netOre;
  return {
    ...base,
    rows: [...base.rows, { label, amountOre: netOre, kind }, { label: "Moms 25 % på omfördelningen", amountOre: vatOre, kind }],
    totalOre: base.totalOre + deltaGross,
  };
}

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
