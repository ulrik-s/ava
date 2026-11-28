/**
 * Avräkningen i billingRun-routern (#1768, steg 3): förhandsvisningen
 * `coverageSplit` och slutregleringen `settleCoverage`, med beräkningshjälparna.
 * Bokningshjälparna bor i `./settlement-invoices`.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `billingRun.ts`
 * spreadar in i den platta `billingRunRouter` (samma form som `document/`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { settledNote } from "@/lib/shared/billing/billing-notes";
import { krCanCreateInvoice } from "@/lib/shared/billing/billing-todo";
import {
  expenseGrossOre, expenseNetOre, settlementArvodeNet, vatOreOf,
  type UnfrozenWork,
} from "@/lib/shared/billing/billing-work-value";
import { TIMKOSTNADSNORM_FTAX_ORE_PER_H } from "@/lib/shared/billing/brottmalstaxa";
import { rattsskyddCoverage } from "@/lib/shared/billing/coverage-billing";
import { resolveHourlyRate, type LevelRates } from "@/lib/shared/billing/hourly-rate";
import { arvodeInclVatOre } from "@/lib/shared/billing/invoice-calc";
import { isActiveKr, krStateOf } from "@/lib/shared/billing/kostnadsrakning-flow";
import { isRadgivningInvoiced } from "@/lib/shared/billing/rattshjalp";
import { allocateSettlement, type SettlementAllocation } from "@/lib/shared/billing/settlement-allocation";
import { buildSettlementViews } from "@/lib/shared/billing/settlement-view";
import { CURRENT_ROUNDING } from "@/lib/shared/billing/whole-kronor";
import { isoDateOrDateTimeInput } from "@/lib/shared/schemas/common";
import { BILLING_RUN_RECIPIENT_LABELS, billingRunRecipientSchema, type PaymentMethod } from "@/lib/shared/schemas/enums";
import {
  asId, billingRunIdSchema, matterIdSchema,
  type MatterId, type OrganizationId, type UserId,
} from "@/lib/shared/schemas/ids";
import { logMatterNote } from "../../billing/matter-note";
import { emit } from "../../events/emit";
import { callTime, dateOrCallTime, newRowId } from "../../queued-call";
import type { BillingRunListRow } from "../../repositories/billing-run-repository";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";
import {
  bookFirmLoss, bookPayerRun, buildSettlementBreakdown, createClientSettlementInvoice, linkSettlementInvoices,
} from "./settlement-invoices";
import {
  applyKrTransition, assertFlowAction, fetchDeductedAccontoRuns, fetchUnfrozenWork, fetchWorkByRun, invoiceNumbering,
  undeductedAccontoIds,
} from "./shared";

/**
 * Underlag för slutreglering (#806): väntar en kostnadsräkning på dom använder
 * vi dess frysta rader (rättshjälp), annars allt ofryst (rättsskydd har ingen
 * kostnadsräkning). Returnerar även körningen så den kan konsumeras vid domen.
 */
async function resolveSettlementWork(
  repos: Repositories, orgId: OrganizationId, matterId: MatterId,
): Promise<{ work: UnfrozenWork; krRun: BillingRunListRow | undefined }> {
  const runs = await repos.billingRuns.listForOrg(orgId, matterId);
  const krRun = runs.find(isActiveKr);
  const work = krRun ? await fetchWorkByRun(repos, krRun.id) : await fetchUnfrozenWork(repos, matterId);
  return { work, krRun };
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
  if (!krCanCreateInvoice(krRun)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Registrera domstolens beslut innan du skapar fakturan." });
  }
  return krRun.awardedOre ?? null;
}

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

export const settlementProcedures = {
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
        // Auto-dra av skickade klient-aconton (#856), utöver ev. explicit valda,
        // men aldrig ett som en tidigare slutfaktura redan dragit av (#1892).
        const deductIds = await undeductedAccontoIds(tx, ctx.orgId, input.matterId, input.deductedBillingRunIds);
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
};
