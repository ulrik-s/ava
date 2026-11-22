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
import { accontoSplit, deductAcconto } from "@/lib/shared/acconto-vat";
import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { invoiceCreatedNote, settledNote } from "@/lib/shared/billing-notes";
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";
import {
  expenseGrossOre,
  expenseNetOre, invoiceGrossOre, invoiceVatBreakdown, matterArvodeNet,
  settlementArvodeNet, vatOreOf,
  type UnfrozenWork,
} from "@/lib/shared/billing-work-value";
import { TIMKOSTNADSNORM_FTAX_ORE_PER_H } from "@/lib/shared/brottmalstaxa";
import { rattsskyddCoverage } from "@/lib/shared/coverage-billing";
import { resolveHourlyRate, type LevelRates } from "@/lib/shared/hourly-rate";
import { arvodeInclVatOre } from "@/lib/shared/invoice-calc";
import type { SpecDeduction } from "@/lib/shared/invoice-specification";
import { krStateOf } from "@/lib/shared/kostnadsrakning-flow";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { isRadgivningInvoiced } from "@/lib/shared/rattshjalp";
import { settlementBreakdownSchema, type BillingRun, type Invoice } from "@/lib/shared/schemas/billing";
import { isoDateOrDateTimeInput } from "@/lib/shared/schemas/common";
import { BILLING_RUN_RECIPIENT_LABELS, billingRunRecipientSchema, type BillingRunRecipient, type PaymentMethod } from "@/lib/shared/schemas/enums";
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
import { allocateSettlement, settlementAmounts, type SettlementAllocation } from "@/lib/shared/settlement-allocation";
import {
  buildClientArvodeLines, buildCreditView, buildSettlementViews, creditPayload, radgivningOre,
  type SettlementBreakdown, type SettlementView,
} from "@/lib/shared/settlement-view";
import { DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { CURRENT_ROUNDING, roundToKronor } from "@/lib/shared/whole-kronor";
import { logMatterNote } from "../billing/matter-note";
import { emit, type EmitCtx } from "../events/emit";
import { callTime, dateOrCallTime, newRowId, type QueuedCallScope } from "../queued-call";
import type { BillingRunListRow } from "../repositories/billing-run-repository";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";
import { kostnadsrakningProcedures } from "./billingRun/kostnadsrakning";
import { pruningProcedures } from "./billingRun/pruning";
import { readProcedures } from "./billingRun/read";
import {
  applyKrTransition, assertFlowAction, fetchDeductedAccontoRuns, fetchUnfrozenWork, fetchWorkByRun,
  freezeWork, invoiceNumbering, linkFinalInvoice, sumPriorAccontos,
} from "./billingRun/shared";











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
async function bookFirmLoss(repos: Repositories, a: { userId: UserId; matterId: MatterId; firmLossOre: number; scope: QueuedCallScope }): Promise<void> {
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
async function bookPayerRun(repos: Repositories, p: PayerRunInput): Promise<BillingRun> {
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

/** Det slutregleringen fördelar: ärendet, arbetet och domstolens beslut. */
interface SettlementLinesInput {
  matter: Parameters<typeof rattsskyddCoverage>[0] & { paymentMethod: PaymentMethod; clientShareBips?: number | null | undefined };
  work: UnfrozenWork;
  totalArvodeNet: number;
  awardedOre: number | null;
  insurerPrutningOre: number | undefined;
  settleDate: Date | string;
}

/**
 * Fördelningen mellan klient och betalare med fakturornas rader (#1438): totalen
 * räknas en gång — domstolens beslut som det är, annars fakturans uträkning —
 * klienten får sin andel av totalen inkl moms och betalaren resten. Domstolens
 * nedsättning (#943) träffar hela anspråket, arvode och utlägg, eftersom beslutet
 * fördelas över alla rader. Rättsskyddets prutning efter slutregleringen är en
 * egen händelse (`recordInsurerPruning`).
 */
function settlementLines(a: SettlementLinesInput): SettlementAllocation {
  return allocateSettlement({
    method: a.matter.paymentMethod, totalArvodeNet: a.totalArvodeNet, work: a.work,
    clientShareBips: a.matter.clientShareBips ?? 0, awardedOre: a.awardedOre,
    insurerPrutningOre: a.insurerPrutningOre,
    coverage: rattsskyddCoverage(a.matter, a.work.timeEntries, a.settleDate),
  });
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


async function buildSettlementBreakdown(repos: Repositories, orgId: OrganizationId, a: {
  clientShareBips: number; totalArvodeNet: number; allocation: SettlementAllocation; work: UnfrozenWork;
  clientPayable: number; radgivningInvoiced: boolean; rateOre: number; settleDate: Date | string;
  deductedRuns: ReadonlyArray<{ invoiceId?: InvoiceId | null | undefined }>;
}): Promise<SettlementBreakdown> {
  // Rådgivningstimmen ingår ALDRIG i domstolens arvode (#860/#1205) — den är en
  // låst, redan fakturerad post och finns inte i `work`; den omnämns bara.
  // Delbeloppen läses ur fakturornas egna rader (#1438), så vyn och fakturan är samma tal.
  const deductedAccontos: SpecDeduction[] = [];
  for (const r of a.deductedRuns) {
    if (!r.invoiceId) continue;
    const inv = await repos.invoices.getByIdInOrg(r.invoiceId, orgId);
    if (inv) deductedAccontos.push({ invoiceNumber: inv.invoiceNumber ?? "—", date: inv.invoiceDate ?? null, amountOre: inv.amount });
  }
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


async function createClientSettlementInvoice(repos: Repositories, ctx: EmitCtx & QueuedCallScope, orgId: OrganizationId, a: {
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
  a: { matterId: MatterId; work: UnfrozenWork; selected: boolean; runId: BillingRunId; now: Date },
): Promise<void> {
  const { matterId, work, runId, now } = a;
  if (!a.selected) {
    await freezeWork(repos, matterId, runId, now);
    return;
  }
  await repos.timeEntries.freezeByIds(work.timeEntries.map((t) => t.id), runId, now);
  await repos.expenses.freezeByIds(work.expenses.map((e) => e.id), runId, now);
}



/**
 * Valfritt klient-id + datum (paritet med legacy `invoice.createFinal` så demo-
 * generatorn/fixtures kan styra dem). Default-invoiceDate = nu. Tomma → store
 * genererar id / sätter dueDate null.
 */
function invoiceMeta(
  scope: QueuedCallScope,
  input: { id?: string | undefined; invoiceDate?: string | undefined; dueDate?: string | undefined },
): Partial<{ id: ReturnType<typeof asId<"InvoiceId">>; invoiceDate: Date; dueDate: Date }> {
  return omitUndefined({
    id: input.id ? asId<"InvoiceId">(input.id) : undefined,
    invoiceDate: dateOrCallTime(scope, input.invoiceDate),
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
  });
}

export const billingRunRouter = router({
  ...readProcedures,
  ...kostnadsrakningProcedures,
  ...pruningProcedures,
  createAcconto: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      recipient: billingRunRecipientSchema.default("KLIENT"),
      clientShareBips: z.number().int().min(0).max(10000),
      amountOre: z.number().int().nonnegative(),
      // Valfri paritet med legacy (demo/fixtures): klient-id + datum.
      id: invoiceIdSchema.optional(),
      invoiceDate: isoDateOrDateTimeInput.optional(),
      dueDate: isoDateOrDateTimeInput.optional(),
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
        const at = callTime(ctx);
        const invoiceDate = dateOrCallTime(ctx, input.invoiceDate);
        const value = matterArvodeNet(matter, work, at) + expenseNetOre(work);
        // #397: dra av tidigare aconton i det FÖRESLAGNA beloppet —
        // belopp = %-sats × upparbetat − Σ tidigare aconto-fakturor.
        const priorAccontoSumOre = await sumPriorAccontos(tx, input.matterId);
        const proposedOre = proposedAccontoOre(value, input.clientShareBips, priorAccontoSumOre);
        // Acconto är ett brutto-förskott på arvode (25 % moms ingår, #782). Beloppet
        // är fakturans enda rad → hela kronor (#1438), och nettot likaså.
        const amountOre = roundToKronor(input.amountOre);
        const { netOre: accontoNetOre, vatOre: accontoVatOre } = accontoSplit(amountOre);
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: amountOre, vatOre: accontoVatOre, amountRounding: CURRENT_ROUNDING,
          vatBreakdown: [{ kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: accontoNetOre, vatOre: accontoVatOre }],
          // Nedbrytning (#878/#880): anroparen (simuleringen) skickar en spec med det
          // upparbetade arbetet så klienten ser vad acontot avser; annars en enkel default.
          settlementBreakdown: input.settlementBreakdown ?? {
            timeLines: [],
            rows: [
              { label: `Klientens andel ${input.clientShareBips / 100} % av upparbetat arbete (exkl moms)`, amountOre: accontoNetOre, kind: "add" },
              { label: "Moms 25 %", amountOre: accontoVatOre, kind: "add" },
            ],
            totalLabel: "Att betala (inkl moms)", totalOre: amountOre,
          },
          invoiceType: "ACCONTO", status: "DRAFT",
          ...(await invoiceNumbering(tx, ctx.orgId, input.recipient, invoiceDate)),
          ...invoiceMeta(ctx, input), notes: input.notes,
        });
        const run = await tx.billingRuns.create({
          id: asId<"BillingRunId">(newRowId(ctx, "billingRun")),
          matterId: input.matterId, type: "ACCONTO", recipient: input.recipient,
          status: "SENT", workValueOreAtRun: value, clientShareBips: input.clientShareBips,
          proposedAmountOre: proposedOre, amountOre,
          invoiceId: invoice.id, deductedBillingRunIds: [],
          periodTo: at, notes: input.notes,
        });
        await logMatterNote(tx, ctx, input.matterId, invoiceCreatedNote(invoice.invoiceNumber, "ACCONTO", invoice.amount), invoiceDate);
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
      invoiceDate: isoDateOrDateTimeInput.optional(),
      dueDate: isoDateOrDateTimeInput.optional(),
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
        const at = callTime(ctx);
        const invoiceDate = dateOrCallTime(ctx, input.invoiceDate);
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: finalAmount, vatOre: vatOreOf(rest.lines),
          vatBreakdown: rest.lines, amountRounding: CURRENT_ROUNDING,
          invoiceType: "FINAL", status: "DRAFT",
          ...(await invoiceNumbering(tx, ctx.orgId, input.recipient, invoiceDate)),
          ...invoiceMeta(ctx, input), notes: input.notes,
        });
        const run = await tx.billingRuns.create({
          id: asId<"BillingRunId">(newRowId(ctx, "billingRun")),
          matterId: input.matterId, type: "FINAL", recipient: input.recipient,
          status: "SENT", workValueOreAtRun: grossValue,
          proposedAmountOre: grossValue, amountOre: finalAmount,
          invoiceId: invoice.id, deductedBillingRunIds: input.deductedBillingRunIds,
          periodTo: at, notes: input.notes,
        });
        await freezeSelectedWork(tx, { matterId: input.matterId, work, selected, runId: run.id, now: at });
        // Länka posterna + acconto-avdrag → slutfaktura-vyn visar rätt arvode/utlägg (#728).
        await linkFinalInvoice(tx, invoice.id, work, accontoInvoiceIds(deductedRuns), ctx);
        await logMatterNote(tx, ctx, input.matterId, invoiceCreatedNote(invoice.invoiceNumber, "FINAL", invoice.amount), invoiceDate);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
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
      // Utläggen ingår i totalen och delas i samma steg som arvodet (#849/#1438).
      // Både netto OCH brutto returneras: utläggen har BLANDADE momssatser, så
      // bruttot kan inte räknas ur nettot med en platt sats (#850).
      const expensesNetOre = expenseNetOre(work);
      const expensesGrossOre = expenseGrossOre(work);
      // Samma fördelning som slutregleringen (#1438): klienten får sin andel av
      // totalen inkl moms, betalaren resten.
      const allocation = settlementLines({
        matter, work, totalArvodeNet: totalOre, awardedOre: input.awardedOre ?? null,
        insurerPrutningOre: input.insurerPrutningOre, settleDate: new Date(),
      });
      const firmLossOre = allocation.arvodeLossNetOre + allocation.expenseLossNetOre;
      return {
        ...allocation.split, firmLossOre,
        clientGrossOre: allocation.clientGrossOre, payerGrossOre: allocation.payerGrossOre,
        firmLossGrossOre: arvodeInclVatOre(totalOre) + expensesGrossOre - allocation.totalGrossOre,
        totalOre, expensesNetOre, expensesGrossOre, currentRateOre, billableMinutes,
      };
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
      invoiceDate: isoDateOrDateTimeInput.optional(),
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
        const settleDate = dateOrCallTime(ctx, input.invoiceDate);
        const totalArvodeNet = settlementArvodeNet(matter.paymentMethod, work, settleDate);
        const allocation = settlementLines({ matter, work, totalArvodeNet, awardedOre, insurerPrutningOre: input.insurerPrutningOre, settleDate });
        const { split, clientLines, payerLines } = allocation;

        // Klient: självrisk (+ ev. prutning), moms 25 %, minus tidigare aconton.
        // Auto-dra av ALLA skickade klient-aconton (#856): de har redan betalats,
        // så slutfakturan reduceras med dem (utöver ev. explicit valda).
        const sentAccontoIds = (await tx.billingRuns.listAccontoSent(input.matterId)).map((r) => r.id);
        const deductIds = [...new Set([...input.deductedBillingRunIds, ...sentAccontoIds])];
        const clientGross = allocation.clientGrossOre;
        const deductedRuns = await fetchDeductedAccontoRuns(tx, input.matterId, deductIds);
        const deductionOre = deductedRuns.reduce((s, r) => s + (r.amountOre ?? 0), 0);
        const clientAmount = Math.max(0, clientGross - deductionOre);
        const payerGross = allocation.payerGrossOre;

        // Bygg slutregleringsvyerna FÖRE fakturorna (#876) så de kan persisteras på
        // respektive faktura → EN källa för både dokumentet och Slutfaktura-sidan.
        const breakdown = await buildSettlementBreakdown(tx, ctx.orgId, {
          clientShareBips: matter.clientShareBips ?? 0, totalArvodeNet, allocation, work, clientPayable: clientAmount,
          radgivningInvoiced: isRadgivningInvoiced(matter), rateOre, settleDate, deductedRuns,
        });
        const { clientView, payerView } = buildSettlementViews(breakdown, matter.paymentMethod);

        // Klientfakturan: EN faktura (FINAL om skyldig, CREDIT om överbetald) — aldrig 0.00 (#878).
        const { invoice: clientInvoice, creditInvoice } = await createClientSettlementInvoice(tx, ctx, ctx.orgId, {
          matterId: input.matterId, clientGrossOre: clientGross, deductionOre, clientLines, clientView,
          method: matter.paymentMethod, invoiceDate: settleDate, notes: input.notes,
        });
        const payerInvoice = await tx.invoices.create({
          id: asId<"InvoiceId">(newRowId(ctx, "payerInvoice")),
          matterId: input.matterId, amount: payerGross, vatOre: vatOreOf(payerLines), vatBreakdown: payerLines,
          settlementBreakdown: payerView, amountRounding: CURRENT_ROUNDING,
          invoiceType: "FINAL", status: "DRAFT", ...(await invoiceNumbering(tx, ctx.orgId, input.payerRecipient, settleDate)), invoiceDate: settleDate, notes: input.notes,
        });
        await bookFirmLoss(tx, { userId: ctx.user.id, matterId: input.matterId, firmLossOre: allocation.arvodeLossNetOre + allocation.expenseLossNetOre, scope: ctx });
        const clientRun = await tx.billingRuns.create({
          id: asId<"BillingRunId">(newRowId(ctx, "clientRun")),
          matterId: input.matterId, type: "FINAL", recipient: "KLIENT", status: "SENT",
          workValueOreAtRun: clientGross, proposedAmountOre: clientGross, amountOre: clientInvoice.amount,
          invoiceId: clientInvoice.id, deductedBillingRunIds: deductIds, periodTo: callTime(ctx), notes: input.notes,
        });
        const payerRun = await bookPayerRun(tx, {
          matterId: input.matterId, payerRecipient: input.payerRecipient, payerInvoiceId: payerInvoice.id,
          payerGross, notes: input.notes, krRun, scope: ctx,
        });
        await linkSettlementInvoices(tx, { work, payerInvoiceId: payerInvoice.id, clientInvoiceId: clientInvoice.id, deductedRuns, scope: ctx });
        // KR:n förblir en distinkt kostnadsräkning (med sitt dokument/beslut) —
        // konsumeras EJ in i fakturan; markeras FAKTURERAD (#828).
        if (krRun) {
          const next = applyKrTransition(krStateOf(krRun), "SKAPA_FAKTURA");
          await tx.billingRuns.update(krRun.id, { status: "SENT", kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt });
        }
        await logMatterNote(tx, ctx, input.matterId, settledNote({
          client: { invoiceNumber: clientInvoice.invoiceNumber, amountOre: clientInvoice.amount, credit: creditInvoice !== null },
          payer: { invoiceNumber: payerInvoice.invoiceNumber, amountOre: payerInvoice.amount, recipientLabel: BILLING_RUN_RECIPIENT_LABELS[input.payerRecipient] },
        }), settleDate);
        await emit.invoiceCreated(ctx, payerInvoice); // klientfakturan emittas i helpern
        // `creditInvoice` = klientfakturan när den blev en CREDIT (överfakturerad), annars null.
        return { split, clientInvoice, payerInvoice, creditInvoice, clientRun, payerRun, breakdown };
      });
    }),
});

/** Acconto-fakturornas id ur avdragna körningar (för acconto_deductions-raderna). */
function accontoInvoiceIds(runs: ReadonlyArray<BillingRun>): InvoiceId[] {
  return runs.map((r) => r.invoiceId).filter((id): id is NonNullable<typeof id> => id != null);
}
