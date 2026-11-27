/**
 * Kostnadsräkningens procedurer i billingRun-routern (#1767, steg 2): skapa,
 * ångra, registrera beslut, överklaga och skapa fakturan efter beslutet.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `billingRun.ts`
 * spreadar in i den platta `billingRunRouter` (samma form som `document/`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  beslutRegisteredNote, invoiceCreatedNote, kostnadsrakningSubmittedNote, krAppealedNote, krVoidedNote,
} from "@/lib/shared/billing/billing-notes";
import { krCanCreateInvoice } from "@/lib/shared/billing/billing-todo";
import { krGrossOre, matterKrArvodeRows } from "@/lib/shared/billing/billing-work-value";
import { isKrWorkEntry } from "@/lib/shared/billing/kostnadsrakning";
import { canVoidKostnadsrakning, krStateOf, type KostnadsrakningAction } from "@/lib/shared/billing/kostnadsrakning-flow";
import { DEFAULT_VAT_RATE } from "@/lib/shared/billing/vat";
import { CURRENT_ROUNDING, splitGross } from "@/lib/shared/billing/whole-kronor";
import { forordnandeAvslutSchema } from "@/lib/shared/schemas/enums";
import {
  asId, billingRunIdSchema, contactIdSchema, expenseIdSchema, matterIdSchema, timeEntryIdSchema,
  type BillingRunId, type ExpenseId, type MatterId, type OrganizationId,
} from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { krCourtName } from "../../billing/kr-court";
import { krRunForordnandeAvslut, krRunGrossOre, krRunNotes, valueKrRun } from "../../billing/kr-run-valuation";
import { logMatterNote } from "../../billing/matter-note";
import { removeVoidedKrDocuments } from "../../billing/void-kr-documents";
import { emit } from "../../events/emit";
import { callTime, newRowId } from "../../queued-call";
import type { BillingRunDetailRow } from "../../repositories/billing-run-repository";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";
import {
  applyKrTransition, assertFlowAction, fetchSelectedWork, fetchWorkByRun, freezeSelectedWork, freezeWork,
  invoiceNumbering, linkFinalInvoice, type SelectedWork,
} from "./shared";

/**
 * Arbetet kostnadsräkningen värderar, med hela raderna — värderingen läser datum
 * och beskrivning (#1024): de valda posterna (#1889), eller utan urval allt
 * ofryst. Förhandlingsposter värderas inte som arbete — tiden är huvud-
 * förhandlingens (samma regel som dokumentet). De fryses ändå med körningen.
 */
async function fetchKrWork(repos: Repositories, matterId: MatterId, selected: SelectedWork | null) {
  const te = selected ? selected.timeEntries : await repos.timeEntries.listUnfrozenForMatter(matterId);
  const ex = selected ? selected.expenses : await repos.expenses.listUnfrozenForMatter(matterId);
  return { timeEntries: te.filter(isKrWorkEntry), expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

/** Hämta en KOSTNADSRAKNING-körning org-scopat; kastar om saknad/fel typ. */
async function assertKostnadsrakning(repos: Repositories, billingRunId: BillingRunId, orgId: OrganizationId): Promise<BillingRunDetailRow> {
  const run = await repos.billingRuns.getByIdInOrg(billingRunId, orgId);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Kostnadsräkningen finns inte." });
  if (run.type !== "KOSTNADSRAKNING") throw new TRPCError({ code: "BAD_REQUEST", message: "Åtgärden gäller bara kostnadsräkningar." });
  return run;
}

export const kostnadsrakningProcedures = {
  createKostnadsrakning: orgProcedure
    .input(z.object({
      matterId: matterIdSchema, notes: z.string().nullish(),
      // Dialogens huvudförhandling + nivå (#1024) — brottmålstaxan räknas på dem.
      hufStart: z.string().datetime().optional(),
      hufEnd: z.string().datetime().optional(),
      taxaLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
      isTaxeArende: z.boolean().optional(),
      hasFTax: z.boolean().optional(),
      // Förordnandemål (#1857): avslutet väljs i dialogen; utan fältet som förut.
      forordnande: z.object({ avslut: forordnandeAvslutSchema }).optional(),
      // Urvalet (#1889), som createFinal: anges → yrka/frys ENBART dessa; utelämnas → allt ofryst.
      timeEntryIds: z.array(timeEntryIdSchema).optional(),
      expenseIds: z.array(expenseIdSchema).optional(),
      // Domstolen vald i dialogen (#1891), bara till anteckningen; utan fältet ärendets.
      courtContactId: contactIdSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertFlowAction(tx, ctx.orgId, input.matterId, "KOSTNADSRAKNING");
        const court = await krCourtName(tx, ctx.orgId, input.matterId, input.courtContactId);
        const selected = await fetchSelectedWork(tx, input.matterId, input);
        const work = await fetchKrWork(tx, input.matterId, selected);
        const matter = await tx.matters.getByIdInOrg(input.matterId, ctx.orgId);
        if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
        // Domstolen ersätter enligt Domstolsverkets normer — rättshjälp (#839)
        // och offentligt uppdrag (#1003) värderas per kategori-norm på yrkande-
        // dagen (retroaktiv norm, #891), inte på posternas egna á-priser.
        // TAXA-ÄRENDEN (#1024): brottmålstaxan + tidsspillan utöver timmen +
        // beredskapen, räknat med SAMMA funktion som dokumentet.
        // Avrundat per rad till hela kronor som kostnadsräkningens dokument (#1218).
        const now = callTime(ctx);
        const valuation = valueKrRun(matter, work, input, now);
        if (Object.keys(valuation.matterPatch).length > 0) await tx.matters.update(input.matterId, valuation.matterPatch);
        const grossValue = krRunGrossOre(valuation, () =>
          krGrossOre(work, matterKrArvodeRows({ ...matter, ...valuation.matterPatch }, work, now)));
        const run = await tx.billingRuns.create({
          id: asId<"BillingRunId">(newRowId(ctx, "billingRun")),
          matterId: input.matterId, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
          status: "PENDING_VERDICT", kostnadsrakningStatus: "INSKICKAD", workValueOreAtRun: grossValue,
          reference: await tx.billingRuns.nextKrReference(ctx.orgId, stockholmYear(now)),
          proposedAmountOre: grossValue, amountOre: grossValue,
          invoiceId: null, deductedBillingRunIds: [],
          // Avslutet i egen kolumn (#2180) och, tills vidare, i anteckningen (expand).
          periodTo: now, notes: krRunNotes(input.notes, input), forordnandeAvslut: krRunForordnandeAvslut(input),
        });
        // Kostnadsräkningen ÄR inskicket — frys arbetet direkt (#806) så det
        // lämnar "Upparbetat ofakturerat". Dom/slutreglering läser raderna via
        // körningen (fetchWorkByRun), inte som ofryst.
        await freezeSelectedWork(tx, { matterId: input.matterId, selected, runId: run.id, now });
        await logMatterNote(tx, ctx, input.matterId, kostnadsrakningSubmittedNote(run.reference, court, grossValue));
        return { run };
      });
    }),

  /**
   * Ångra en kostnadsräkning (#1121) — t.ex. skapad av misstag eller innan allt
   * arbete registrerats. Bara före domstolens beslut (`canVoidKostnadsrakning`).
   * Låser upp EXAKT de poster körningen frös, och annullerar körningen (VOIDED)
   * så ärendet lämnar "väntar på dom" och en ny kostnadsräkning kan skapas.
   * Kostnadsräkningens dokument tas bort i samma transaktion (#1230).
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
        // Dokumentet presenterade det inskickade — ångrat inskick, borttaget dokument (#1230).
        const doc = await removeVoidedKrDocuments(tx, ctx.ports.searchIndex, ctx.orgId, run);
        await logMatterNote(tx, ctx, run.matterId, krVoidedNote(run.reference, doc));
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
        await logMatterNote(tx, ctx, run.matterId, beslutRegisteredNote({
          hovratt: action === "REGISTRERA_HOVRATT_BESLUT", awardedOre: input.awardedOre,
          claimedOre: run.workValueOreAtRun, prutningOre: input.prutningOre,
        }));
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
        await logMatterNote(tx, ctx, run.matterId, krAppealedNote(run.reference));
        return { run: updated };
      });
    }),

  setVerdict: orgProcedure
    .input(z.object({ billingRunId: billingRunIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const run = await assertKostnadsrakning(tx, input.billingRunId, ctx.orgId);
        // Faktura skapas EFTER beslutet (#828): KR:n måste vara BESLUTAD; prutningen
        // läses från KR:ns registrerade beslut, inte som input.
        if (!krCanCreateInvoice(run)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Registrera domstolens beslut innan du skapar fakturan." });
        }
        const prutningOre = run.prutningOre ?? 0;
        const finalAmount = Math.max(0, run.workValueOreAtRun + prutningOre);
        let prutningExpenseId: ExpenseId | undefined;
        if (prutningOre < 0) {
          const prutning = await tx.expenses.create({
            id: asId<"ExpenseId">(newRowId(ctx, "prutning")),
            matterId: run.matterId, userId: ctx.user.id, date: callTime(ctx),
            amount: prutningOre, description: "Prutning enligt dom",
            billable: true, vatRate: 0, vatIncluded: false, kind: "PRUTNING",
          });
          prutningExpenseId = prutning.id;
        }
        // Posterna frystes redan vid kostnadsräkningens inskick (#806) → läs dem
        // via körningen. PRUTNING (nyss skapad) länkas separat nedan.
        const work = await fetchWorkByRun(tx, run.id);
        const invoiceDate = callTime(ctx);
        const invoice = await tx.invoices.create({
          id: asId<"InvoiceId">(newRowId(ctx, "invoice")),
          // Yrkandet är i hela kronor (#1218); domstolens prutning tas som den är.
          // Momsen följer med så verifikatet bokför samma tal som fakturan (#1438).
          matterId: run.matterId, amount: finalAmount, vatOre: splitGross(finalAmount, DEFAULT_VAT_RATE).vatOre, amountRounding: CURRENT_ROUNDING,
          invoiceType: "FINAL", status: "DRAFT",
          // DOMSTOL → F-nummer (samma format som övriga, #889) men ingen OCR.
          ...(await invoiceNumbering(tx, ctx.orgId, "DOMSTOL", invoiceDate)),
          invoiceDate,
        });
        const next = applyKrTransition(krStateOf(run), "SKAPA_FAKTURA");
        await tx.billingRuns.update(run.id, {
          status: "SENT", invoiceId: invoice.id, amountOre: finalAmount,
          kostnadsrakningStatus: next.status, beslutSlutgiltigt: next.slutgiltigt,
        });
        await freezeWork(tx, run.matterId, run.id, invoiceDate);
        // Länka poster + PRUTNING-utlägget → kostnadsräknings-vyn visar uppdelning
        // och totalen (arvode + utlägg − prutning) reconciler mot beloppet (#732).
        await linkFinalInvoice(tx, invoice.id, work, [], ctx);
        if (prutningExpenseId) await tx.expenses.flagBilled([prutningExpenseId], invoice.id);
        await logMatterNote(tx, ctx, run.matterId, invoiceCreatedNote(invoice.invoiceNumber, "FINAL", invoice.amount, "kostnadsräkning till domstol"));
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),
};
