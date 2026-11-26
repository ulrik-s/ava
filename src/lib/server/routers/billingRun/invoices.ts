/**
 * Fakturaprocedurerna i billingRun-routern (#1769, steg 4): acontofakturan
 * `createAcconto` och slutfakturan `createFinal`, med hjälparna som bara de använder.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `billingRun.ts`
 * spreadar in i den platta `billingRunRouter` (samma form som `document/`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accontoSplit, deductAcconto } from "@/lib/shared/acconto-vat";
import { buildAccontoView, type AccontoWork } from "@/lib/shared/acconto-view";
import { invoiceCreatedNote } from "@/lib/shared/billing-notes";
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";
import {
  expenseNetOre, invoiceGrossOre, invoiceVatBreakdown, matterArvodeNet, vatOreOf,
  type UnfrozenWork, type ValuationMatter,
} from "@/lib/shared/billing-work-value";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { settlementBreakdownSchema, type BillingRun } from "@/lib/shared/schemas/billing";
import { isoDateOrDateTimeInput } from "@/lib/shared/schemas/common";
import { billingRunRecipientSchema } from "@/lib/shared/schemas/enums";
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
} from "@/lib/shared/schemas/ids";
import type { SettlementView } from "@/lib/shared/settlement-view";
import { DEFAULT_VAT_RATE } from "@/lib/shared/vat";
import { CURRENT_ROUNDING, roundToKronor } from "@/lib/shared/whole-kronor";
import { logMatterNote } from "../../billing/matter-note";
import { emit } from "../../events/emit";
import { callTime, dateOrCallTime, newRowId, type QueuedCallScope } from "../../queued-call";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";
import {
  assertFlowAction, fetchDeductedAccontoRuns, fetchUnfrozenWork,
  freezeWork, invoiceNumbering, linkFinalInvoice, priorAccontoDeductions, sumPriorAccontos,
} from "./shared";

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

/**
 * Acontofakturans nedbrytning (#1940). En nedbrytning som anroparen skickar
 * (simuleringen, demon) gäller som den är. Annars byggs den ur underlaget och
 * de tidigare acontofakturorna, så att dokumentet visar vad beloppet bygger på
 * och blir detsamma när fakturan skickas senare.
 */
async function accontoBreakdown(repos: Repositories, orgId: OrganizationId, a: {
  given: SettlementView | null | undefined; matterId: MatterId; matter: ValuationMatter;
  work: AccontoWork; at: Date; clientShareBips: number; amountOre: number;
}): Promise<SettlementView> {
  if (a.given) return a.given;
  const deductions = await priorAccontoDeductions(repos, orgId, a.matterId);
  return buildAccontoView({
    matter: a.matter, work: a.work, at: a.at,
    clientShareBips: a.clientShareBips, amountOre: a.amountOre, deductions,
  });
}

export const invoiceProcedures = {
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
       *  (tidsspec) så klienten ser vad acontot avser. Utelämnas → byggs (#1940). */
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
        const settlementBreakdown = await accontoBreakdown(tx, ctx.orgId, {
          given: input.settlementBreakdown, matterId: input.matterId, matter, work, at,
          clientShareBips: input.clientShareBips, amountOre,
        });
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: amountOre, vatOre: accontoVatOre, amountRounding: CURRENT_ROUNDING,
          vatBreakdown: [{ kind: "arvode", vatRate: DEFAULT_VAT_RATE, netOre: accontoNetOre, vatOre: accontoVatOre }],
          // Nedbrytning (#878/#880/#1940): vad acontot avser och hur beloppet räknats.
          settlementBreakdown,
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
};

/** Acconto-fakturornas id ur avdragna körningar (för acconto_deductions-raderna). */
function accontoInvoiceIds(runs: ReadonlyArray<BillingRun>): InvoiceId[] {
  return runs.map((r) => r.invoiceId).filter((id): id is NonNullable<typeof id> => id != null);
}
