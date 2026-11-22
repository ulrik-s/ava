/**
 * Läsprocedurerna i billingRun-routern (#1766, steg 1): lista, en körning,
 * fakturaförslaget och fakturaspecifikationen.
 *
 * Exporteras som ett objekt av procedurer som kompositionen i `billingRun.ts`
 * spreadar in i den platta `billingRunRouter` (samma form som `document/`).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildProposal } from "@/lib/shared/billing-proposal";
import {
  buildInvoiceSpecification, specExpenseLines, specTimeLines,
  type InvoiceSpecification, type SpecDeduction,
} from "@/lib/shared/invoice-specification";
import {
  billingRunIdSchema, invoiceIdSchema, matterIdSchema,
  type InvoiceId, type OrganizationId,
} from "@/lib/shared/schemas/ids";
import { roundingOf } from "@/lib/shared/whole-kronor";
import type { Repositories } from "../../repositories/repositories";
import { orgProcedure } from "../../trpc";
import { sumPriorAccontos } from "./shared";

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

export const readProcedures = {
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
      // Fakturans EGET avrundningssätt (#1438): en äldre faktura specificeras
      // på öret, precis som när den skapades — beloppen räknas aldrig om.
      const rounding = roundingOf(invoice);
      return buildInvoiceSpecification({
        timeLines: specTimeLines(matter.paymentMethod, te, invoice.invoiceDate ?? new Date(), rounding),
        expenseLines: specExpenseLines(ex, rounding),
        deductions, payableOre: invoice.amount, rounding,
      });
    }),
};
