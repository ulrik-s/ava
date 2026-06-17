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
import { proposedAccontoOre } from "@/lib/shared/billing-proposal";
import type { BillingRun, Expense, Invoice } from "@/lib/shared/schemas/billing";
import { billingRunRecipientSchema, type ExpenseKind } from "@/lib/shared/schemas/enums";
import {
  matterIdSchema,
  billingRunIdSchema,
  asId,
  type BillingRunId,
} from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";
import type { Repositories } from "../repositories/repositories";
import { router, orgProcedure } from "../trpc";

interface UnfrozenWork {
  timeEntries: Array<{ id: string; minutes: number; hourlyRate: number; billable: boolean }>;
  expenses: Array<{ id: string; amount: number; billable: boolean }>;
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

async function fetchUnfrozenWork(repos: Repositories, matterId: string): Promise<UnfrozenWork> {
  const te = await repos.timeEntries.listUnfrozenForMatter(matterId) as unknown as
    Array<{ id: string; minutes: number; hourlyRate: number; billable: boolean }>;
  const ex = await repos.expenses.listUnfrozenForMatter(matterId) as unknown as
    Array<{ id: string; amount: number; billable: boolean; kind?: ExpenseKind }>;
  return { timeEntries: te, expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

function workValueOre(work: UnfrozenWork): number {
  const time = work.timeEntries
    .filter((t) => t.billable)
    .reduce((sum, t) => sum + timeEntryValueOre(t.minutes, t.hourlyRate), 0);
  const exp = work.expenses
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + e.amount, 0);
  return time + exp;
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
async function sumPriorAccontos(repos: Repositories, matterId: string): Promise<number> {
  const runs = (await repos.billingRuns.listAccontoSent(matterId)) as ReadonlyArray<{ amountOre?: number }>;
  return runs.reduce((sum, r) => sum + (r.amountOre ?? 0), 0);
}

async function freezeWork(repos: Repositories, matterId: string, billingRunId: BillingRunId): Promise<void> {
  const now = new Date();
  await repos.timeEntries.freezeForMatter(matterId, billingRunId, now);
  await repos.expenses.freezeForMatter(matterId, billingRunId, now);
}

async function assertMatterInOrg(repos: Repositories, matterId: string, orgId: string): Promise<void> {
  const m = await repos.matters.getByIdInOrg(matterId, orgId);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
}

export const billingRunRouter = router({
  list: orgProcedure
    .input(z.object({ matterId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.repos.billingRuns.listForOrg(ctx.orgId, input.matterId);
      return { runs };
    }),

  byId: orgProcedure
    .input(z.object({ id: z.string() }))
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
      const te = (await ctx.repos.timeEntries.listUnfrozenForMatter(input.matterId)) as unknown as
        Array<{ id: string; description?: string | null; minutes: number; hourlyRate: number; billable: boolean }>;
      const ex = (await ctx.repos.expenses.listUnfrozenForMatter(input.matterId)) as unknown as
        Array<{ id: string; description?: string | null; amount: number; billable: boolean; kind?: ExpenseKind }>;
      const priorAccontoSumOre = await sumPriorAccontos(ctx.repos, input.matterId);
      return buildProposal(te, ex, priorAccontoSumOre);
    }),

  createAcconto: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      recipient: billingRunRecipientSchema.default("KLIENT"),
      clientShareBips: z.number().int().min(0).max(10000),
      amountOre: z.number().int().nonnegative(),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertMatterInOrg(tx, input.matterId, ctx.orgId);
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        // #397: dra av tidigare aconton i det FÖRESLAGNA beloppet —
        // belopp = %-sats × upparbetat − Σ tidigare aconto-fakturor.
        const priorAccontoSumOre = await sumPriorAccontos(tx, input.matterId);
        const proposedOre = proposedAccontoOre(value, input.clientShareBips, priorAccontoSumOre);
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: input.amountOre,
          invoiceType: "ACCONTO", status: "DRAFT",
          invoiceDate: new Date(), notes: input.notes,
        } as unknown as Partial<Invoice>);
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "ACCONTO", recipient: input.recipient,
          status: "SENT", workValueOreAtRun: value, clientShareBips: input.clientShareBips,
          proposedAmountOre: proposedOre, amountOre: input.amountOre,
          invoiceId: invoice.id, deductedBillingRunIds: [],
          periodTo: new Date(), notes: input.notes,
        } as unknown as Partial<BillingRun>);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),

  createFinal: orgProcedure
    .input(z.object({
      matterId: matterIdSchema,
      recipient: billingRunRecipientSchema,
      deductedBillingRunIds: z.array(billingRunIdSchema).default([]),
      notes: z.string().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertMatterInOrg(tx, input.matterId, ctx.orgId);
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        const deductionOre = await sumDeductions(tx, input.matterId, input.deductedBillingRunIds);
        const finalAmount = Math.max(0, value - deductionOre);
        const invoice = await tx.invoices.create({
          matterId: input.matterId, amount: finalAmount,
          invoiceType: "FINAL", status: "DRAFT",
          invoiceDate: new Date(), notes: input.notes,
        } as unknown as Partial<Invoice>);
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "FINAL", recipient: input.recipient,
          status: "SENT", workValueOreAtRun: value,
          proposedAmountOre: value, amountOre: finalAmount,
          invoiceId: invoice.id, deductedBillingRunIds: input.deductedBillingRunIds,
          periodTo: new Date(), notes: input.notes,
        } as unknown as Partial<BillingRun>);
        await freezeWork(tx, input.matterId, run.id as BillingRunId);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),

  createKostnadsrakning: orgProcedure
    .input(z.object({ matterId: matterIdSchema, notes: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        await assertMatterInOrg(tx, input.matterId, ctx.orgId);
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        const run = await tx.billingRuns.create({
          matterId: input.matterId, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
          status: "PENDING_VERDICT", workValueOreAtRun: value,
          proposedAmountOre: value, amountOre: value,
          invoiceId: null, deductedBillingRunIds: [],
          periodTo: new Date(), notes: input.notes,
        } as unknown as Partial<BillingRun>);
        return { run };
      });
    }),

  setVerdict: orgProcedure
    .input(z.object({
      billingRunId: z.string(),
      prutningOre: z.number().int().nonpositive(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const run = await tx.billingRuns.getByIdInOrg(input.billingRunId, ctx.orgId);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Faktureringshändelsen finns inte." });
        if (run.type !== "KOSTNADSRAKNING" || run.status !== "PENDING_VERDICT") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Bara KOSTNADSRAKNING i PENDING_VERDICT kan domsläggas." });
        }
        const finalAmount = Math.max(0, run.workValueOreAtRun + input.prutningOre);
        if (input.prutningOre < 0) {
          await tx.expenses.create({
            matterId: run.matterId, userId: asId<"UserId">(ctx.user.id), date: new Date(),
            amount: input.prutningOre, description: "Prutning enligt dom",
            billable: true, vatRate: 0, vatIncluded: false, kind: "PRUTNING",
          } as unknown as Partial<Expense>);
        }
        const invoice = await tx.invoices.create({
          matterId: run.matterId, amount: finalAmount,
          invoiceType: "FINAL", status: "DRAFT",
          invoiceDate: new Date(),
        } as unknown as Partial<Invoice>);
        await tx.billingRuns.update(run.id, {
          status: "SENT", invoiceId: invoice.id, amountOre: finalAmount, prutningOre: input.prutningOre,
        } as unknown as Partial<BillingRun>);
        await freezeWork(tx, run.matterId, run.id as BillingRunId);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),
});

async function sumDeductions(
  repos: Repositories,
  matterId: string,
  ids: ReadonlyArray<string>,
): Promise<number> {
  if (ids.length === 0) return 0;
  // Säkerhet (#60): avdragsposterna måste tillhöra SAMMA ärende och vara
  // ACCONTO-körningar — annars kunde en FINAL dra av främmande/fel-typade
  // billing-runs och förvanska beloppet. Kasta om någon id inte matchar.
  const runs = await repos.billingRuns.listAccontoByIds(matterId, [...ids]);
  if (runs.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Någon avdragspost tillhör inte detta ärende eller är ingen ACCONTO-körning.",
    });
  }
  return runs.reduce((sum, r) => sum + ((r as { amountOre: number }).amountOre ?? 0), 0);
}
