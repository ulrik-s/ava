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
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "../trpc";
import type { DataStoreTx } from "../data-store/IDataStore";
import { billingRunRecipientSchema, type ExpenseKind } from "@/lib/shared/schemas/enums";
import {
  matterIdSchema,
  billingRunIdSchema,
  asId,
  type BillingRunId,
} from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";

interface UnfrozenWork {
  timeEntries: Array<{ id: string; minutes: number; hourlyRate: number; billable: boolean }>;
  expenses: Array<{ id: string; amount: number; billable: boolean }>;
}

async function fetchUnfrozenWork(tx: DataStoreTx, matterId: string): Promise<UnfrozenWork> {
  const te = await tx.timeEntries.findMany({
    where: { matterId, frozenByBillingRunId: null },
  }) as Array<{ id: string; minutes: number; hourlyRate: number; billable: boolean }>;
  const ex = await tx.expenses.findMany({
    where: { matterId, frozenByBillingRunId: null },
  }) as Array<{ id: string; amount: number; billable: boolean; kind?: ExpenseKind }>;
  return { timeEntries: te, expenses: ex.filter((e) => e.kind !== "PRUTNING") };
}

function workValueOre(work: UnfrozenWork): number {
  const time = work.timeEntries
    .filter((t) => t.billable)
    .reduce((sum, t) => sum + Math.round((t.minutes / 60) * t.hourlyRate), 0);
  const exp = work.expenses
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + e.amount, 0);
  return time + exp;
}

async function freezeWork(tx: DataStoreTx, matterId: string, billingRunId: BillingRunId): Promise<void> {
  const now = new Date();
  await tx.timeEntries.updateMany({
    where: { matterId, frozenByBillingRunId: null },
    data: { frozenAt: now, frozenByBillingRunId: billingRunId },
  });
  await tx.expenses.updateMany({
    where: { matterId, frozenByBillingRunId: null },
    data: { frozenAt: now, frozenByBillingRunId: billingRunId },
  });
}

async function assertMatterInOrg(tx: DataStoreTx, matterId: string, orgId: string): Promise<void> {
  const m = await tx.matters.findFirst({ where: { id: matterId, organizationId: orgId } });
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
}

export const billingRunRouter = router({
  list: orgProcedure
    .input(z.object({ matterId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const where = input.matterId
        ? { matterId: input.matterId, matter: { organizationId: ctx.orgId } }
        : { matter: { organizationId: ctx.orgId } };
      const runs = await ctx.dataStore.billingRuns.findMany({
        where, orderBy: { createdAt: "desc" },
        include: { invoice: { select: { id: true, invoiceNumber: true, status: true } } },
      });
      return { runs };
    }),

  byId: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.dataStore.billingRuns.findFirstOrThrow({
        where: { id: input.id, matter: { organizationId: ctx.orgId } },
        include: {
          invoice: { select: { id: true, invoiceNumber: true, status: true, amount: true } },
          matter: { select: { id: true, matterNumber: true, title: true, paymentMethod: true } },
        },
      });
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
      return ctx.dataStore.transaction(async (tx) => {
        await assertMatterInOrg(tx, input.matterId, ctx.orgId);
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        const proposedOre = Math.round((value * input.clientShareBips) / 10000);
        const invoice = await tx.invoices.create({
          data: {
            matterId: input.matterId, amount: input.amountOre,
            invoiceType: "ACCONTO", status: "DRAFT",
            invoiceDate: new Date(), notes: input.notes,
          },
        });
        const run = await tx.billingRuns.create({
          data: {
            matterId: input.matterId, type: "ACCONTO", recipient: input.recipient,
            status: "SENT", workValueOreAtRun: value, clientShareBips: input.clientShareBips,
            proposedAmountOre: proposedOre, amountOre: input.amountOre,
            invoiceId: invoice.id, deductedBillingRunIds: [],
            periodTo: new Date(), notes: input.notes,
          },
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
      notes: z.string().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        await assertMatterInOrg(tx, input.matterId, ctx.orgId);
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        const deductionOre = await sumDeductions(tx, input.matterId, input.deductedBillingRunIds);
        const finalAmount = Math.max(0, value - deductionOre);
        const invoice = await tx.invoices.create({
          data: {
            matterId: input.matterId, amount: finalAmount,
            invoiceType: "FINAL", status: "DRAFT",
            invoiceDate: new Date(), notes: input.notes,
          },
        });
        const run = await tx.billingRuns.create({
          data: {
            matterId: input.matterId, type: "FINAL", recipient: input.recipient,
            status: "SENT", workValueOreAtRun: value,
            proposedAmountOre: value, amountOre: finalAmount,
            invoiceId: invoice.id, deductedBillingRunIds: input.deductedBillingRunIds,
            periodTo: new Date(), notes: input.notes,
          },
        });
        await freezeWork(tx, input.matterId, run.id);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),

  createKostnadsrakning: orgProcedure
    .input(z.object({ matterId: matterIdSchema, notes: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        await assertMatterInOrg(tx, input.matterId, ctx.orgId);
        const work = await fetchUnfrozenWork(tx, input.matterId);
        const value = workValueOre(work);
        const run = await tx.billingRuns.create({
          data: {
            matterId: input.matterId, type: "KOSTNADSRAKNING", recipient: "DOMSTOL",
            status: "PENDING_VERDICT", workValueOreAtRun: value,
            proposedAmountOre: value, amountOre: value,
            invoiceId: null, deductedBillingRunIds: [],
            periodTo: new Date(), notes: input.notes,
          },
        });
        return { run };
      });
    }),

  setVerdict: orgProcedure
    .input(z.object({
      billingRunId: z.string(),
      prutningOre: z.number().int().nonpositive(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const run = await tx.billingRuns.findFirstOrThrow({
          where: { id: input.billingRunId, matter: { organizationId: ctx.orgId } },
        });
        if (run.type !== "KOSTNADSRAKNING" || run.status !== "PENDING_VERDICT") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Bara KOSTNADSRAKNING i PENDING_VERDICT kan domsläggas." });
        }
        const finalAmount = Math.max(0, run.workValueOreAtRun + input.prutningOre);
        if (input.prutningOre < 0) {
          await tx.expenses.create({
            data: {
              matterId: run.matterId, userId: asId<"UserId">(ctx.user.id), date: new Date(),
              amount: input.prutningOre, description: "Prutning enligt dom",
              billable: true, vatRate: 0, vatIncluded: false, kind: "PRUTNING",
            },
          });
        }
        const invoice = await tx.invoices.create({
          data: {
            matterId: run.matterId, amount: finalAmount,
            invoiceType: "FINAL", status: "DRAFT",
            invoiceDate: new Date(),
          },
        });
        await tx.billingRuns.update({
          where: { id: run.id },
          data: { status: "SENT", invoiceId: invoice.id, amountOre: finalAmount, prutningOre: input.prutningOre },
        });
        await freezeWork(tx, run.matterId, run.id);
        await emit.invoiceCreated(ctx, invoice);
        return { run, invoice };
      });
    }),
});

async function sumDeductions(
  tx: DataStoreTx,
  matterId: string,
  ids: ReadonlyArray<string>,
): Promise<number> {
  if (ids.length === 0) return 0;
  // Säkerhet (#60): avdragsposterna måste tillhöra SAMMA ärende och vara
  // ACCONTO-körningar — annars kunde en FINAL dra av främmande/fel-typade
  // billing-runs och förvanska beloppet. Kasta om någon id inte matchar.
  const runs = await tx.billingRuns.findMany({
    where: { id: { in: ids }, matterId, type: "ACCONTO" },
  });
  if (runs.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Någon avdragspost tillhör inte detta ärende eller är ingen ACCONTO-körning.",
    });
  }
  return runs.reduce((sum, r) => sum + ((r as { amountOre: number }).amountOre ?? 0), 0);
}
