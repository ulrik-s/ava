/**
 * Fakturerings-router:
 *   • list/getById — läsning
 *   • createAcconto — skapar ACCONTO-faktura (förskott)
 *   • createFinal — bygger FINAL från time entries + expenses, drar av
 *     valda ACCONTO-fakturor (via InvoiceAccontoDeduction)
 *   • recordPayment — registrerar Payment, auto-markerar PAID/COMPLETED
 *   • createPaymentPlan — knyter avbetalningsplan till en SENT faktura
 *   • cancelPaymentPlan — river planen och återställer invoice.status=SENT
 *   • setStatus — manuell statusändring (SENT/CANCELLED/BAD_DEBT)
 *
 * Invariant: allt är scopat till ctx.orgId via matter-joinen, så en org
 * kan aldrig se/mutera en annan orgs fakturor.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "../trpc";
import type { DataStoreTx } from "../data-store/IDataStore";
import { computeFinalInvoiceBreakdown, isPaymentPlanSettled } from "@/lib/shared/invoice-calc";
import { emit } from "../events/emit";
import {
  asId,
  matterIdSchema,
  invoiceIdSchema,
  paymentPlanIdSchema,
  type InvoiceId,
  type TimeEntryId,
  type ExpenseId,
} from "@/lib/shared/schemas/ids";
import { omitUndefined } from "@/lib/shared/omit-undefined";

// ─── createFinal-hjälpare (validera + koppla poster) ──────────────

/** Hämta valda obetalda tidsposter; kasta om någon redan fakturerats/ägs av annat ärende. */
async function fetchUnbilledTimeEntries(tx: DataStoreTx, matterId: string, ids: string[]) {
  const rows = ids.length
    ? await tx.timeEntries.findMany({
        where: { id: { in: ids }, matterId, invoiceId: null },
        include: { user: { select: { hourlyRate: true } } },
      })
    : [];
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Några tidsposter är redan fakturerade eller tillhör annat ärende." });
  }
  return rows;
}

/** Hämta valda obetalda utlägg; kasta om någon redan fakturerats/ägs av annat ärende. */
async function fetchUnbilledExpenses(tx: DataStoreTx, matterId: string, ids: string[]) {
  const rows = ids.length
    ? await tx.expenses.findMany({ where: { id: { in: ids }, matterId, invoiceId: null } })
    : [];
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Några utlägg är redan fakturerade eller tillhör annat ärende." });
  }
  return rows;
}

/** Validera accontos: samma ärende, typ ACCONTO, ej redan avdragna på en FINAL. */
async function fetchDeductibleAccontos(tx: DataStoreTx, matterId: string, ids: string[]) {
  const rows = ids.length
    ? await tx.invoices.findMany({
        where: { id: { in: ids }, matterId, invoiceType: "ACCONTO", deductedOnFinals: { none: {} } },
      })
    : [];
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Några acconto-fakturor är redan avdragna eller tillhör annat ärende." });
  }
  return rows;
}

/**
 * Koppla poster till fakturan + skapa acconto-avdrag via explicita anrop
 * (ej Prisma nested writes) så samma kod kör mot både Postgres och git-store:n.
 */
async function linkBilledItems(
  tx: DataStoreTx,
  invoiceId: InvoiceId,
  timeEntries: ReadonlyArray<{ id: TimeEntryId }>,
  expenses: ReadonlyArray<{ id: ExpenseId }>,
  accontos: ReadonlyArray<{ id: InvoiceId }>,
): Promise<void> {
  if (timeEntries.length) {
    await tx.timeEntries.updateMany({ where: { id: { in: timeEntries.map((t) => t.id) } }, data: { invoiceId } });
  }
  if (expenses.length) {
    await tx.expenses.updateMany({ where: { id: { in: expenses.map((e) => e.id) } }, data: { invoiceId } });
  }
  for (const a of accontos) {
    await tx.accontoDeductions.create({ data: { finalInvoiceId: invoiceId, accontoInvoiceId: a.id } });
  }
}

const invoiceTypeSchema = z.enum(["STANDARD", "ACCONTO", "FINAL"]);
const invoiceStatusSchema = z.enum([
  "DRAFT",
  "SENT",
  "PAID",
  "CANCELLED",
  "BAD_DEBT",
  "INSTALLMENT_PLAN",
]);

export const invoiceRouter = router({
  list: orgProcedure
    .input(
      z.object({
        matterId: z.string().optional(),
        invoiceType: invoiceTypeSchema.optional(),
        status: invoiceStatusSchema.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.dataStore.invoices.findMany({
        where: {
          matter: { organizationId: ctx.orgId },
          ...(input.matterId ? { matterId: input.matterId } : {}),
          ...(input.invoiceType ? { invoiceType: input.invoiceType } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { invoiceDate: "desc" },
        include: {
          matter: { select: { id: true, matterNumber: true, title: true } },
          paymentPlan: true,
          payments: { orderBy: { paidAt: "desc" } },
          accontoDeductions: { include: { accontoInvoice: true } },
          deductedOnFinals: { select: { id: true } },
          creditedInvoice: { select: { id: true, invoiceDate: true, amount: true } },
          creditNote: { select: { id: true, invoiceDate: true, amount: true } },
        },
      }),
    ),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const inv = await ctx.dataStore.invoices.findFirst({
        where: { id: input.id, matter: { organizationId: ctx.orgId } },
        include: {
          matter: { select: { id: true, matterNumber: true, title: true } },
          paymentPlan: { include: { reminders: { orderBy: { sentAt: "desc" } } } },
          payments: {
            orderBy: { paidAt: "desc" },
            include: { recordedBy: { select: { name: true } } },
          },
          timeEntries: true,
          expenses: true,
          documents: { orderBy: { createdAt: "desc" } },
          accontoDeductions: { include: { accontoInvoice: true } },
          deductedOnFinals: { include: { finalInvoice: true } },
          creditedInvoice: { select: { id: true, invoiceDate: true, amount: true, invoiceType: true } },
          creditNote: { select: { id: true, invoiceDate: true, amount: true } },
        },
      });
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      return inv;
    }),

  /** ACCONTO: advokaten anger belopp. Inga time entries/expenses kopplas. */
  createAcconto: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (demo-generator/fixtures) → annars genererar store:n. */
        id: invoiceIdSchema.optional(),
        matterId: matterIdSchema,
        amount: z.number().int().min(1),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await ctx.dataStore.matters.findFirst({
        where: { id: input.matterId, organizationId: ctx.orgId },
      });
      if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
      const invoice = await ctx.dataStore.invoices.create({
        data: omitUndefined({
          id: input.id, // undefined → store genererar
          matterId: input.matterId,
          amount: input.amount,
          invoiceType: "ACCONTO",
          status: "DRAFT",
          invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          notes: input.notes,
        }),
      });
      await emit.invoiceCreated(ctx, invoice);
      return invoice;
    }),

  /**
   * FINAL: summerar valda time entries + expenses, drar av valda acconto-
   * fakturor. Allt går i en transaktion så time entries/expenses inte
   * "flaggas som fakturerade" halvvägs om något kraschar.
   */
  createFinal: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (demo-generator/fixtures) → annars genererar store:n. */
        id: invoiceIdSchema.optional(),
        matterId: matterIdSchema,
        timeEntryIds: z.array(z.string()),
        expenseIds: z.array(z.string()),
        accontoInvoiceIds: z.array(z.string()).default([]),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const matter = await tx.matters.findFirst({
          where: { id: input.matterId, organizationId: ctx.orgId },
        });
        if (!matter) throw new TRPCError({ code: "NOT_FOUND" });

        const timeEntries = await fetchUnbilledTimeEntries(tx, input.matterId, input.timeEntryIds);
        const expenses = await fetchUnbilledExpenses(tx, input.matterId, input.expenseIds);
        const accontos = await fetchDeductibleAccontos(tx, input.matterId, input.accontoInvoiceIds);

        const breakdown = computeFinalInvoiceBreakdown(
          timeEntries.map((t) => ({ minutes: t.minutes, hourlyRate: t.user.hourlyRate ?? 0 })),
          expenses.map((e) => ({ amount: e.amount, billable: e.billable })),
          accontos.map((a) => ({ id: a.id, amount: a.amount })),
        );

        const invoice = await tx.invoices.create({
          data: omitUndefined({
            id: input.id, // undefined → store genererar
            matterId: input.matterId,
            amount: breakdown.grossAmount,
            invoiceType: "FINAL",
            status: "DRAFT",
            invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            notes: input.notes,
          }),
        });

        await linkBilledItems(tx, invoice.id, timeEntries, expenses, accontos);
        return { invoice, breakdown };
      }).then(async (result) => {
        await emit.invoiceCreated(ctx, result.invoice);
        return result;
      });
    }),

  /**
   * CREDIT: krediterar en befintlig faktura. Skapar en ny faktura med
   * negativt belopp som pekar tillbaka på originalet, och sätter originalets
   * status till CANCELLED. Kan inte kreditera en redan krediterad eller
   * annullerad faktura.
   */
  createCredit: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id för kredit-fakturan (demo-generator/fixtures). */
        id: invoiceIdSchema.optional(),
        invoiceId: invoiceIdSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const original = await tx.invoices.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { creditNote: true, paymentPlan: true },
        });
        if (!original) throw new TRPCError({ code: "NOT_FOUND" });
        if (original.invoiceType === "CREDIT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Kan inte kreditera en kreditfaktura.",
          });
        }
        if (original.creditNote) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Fakturan är redan krediterad.",
          });
        }
        if (original.status === "CANCELLED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Kan inte kreditera en annullerad faktura.",
          });
        }

        // Om originalet har en aktiv avbetalningsplan: avbryt den
        if (original.paymentPlan && original.paymentPlan.status === "ACTIVE") {
          await tx.paymentPlans.update({
            where: { id: original.paymentPlan.id },
            data: { status: "CANCELLED" },
          });
        }

        const credit = await tx.invoices.create({
          data: {
            ...omitUndefined({ id: input.id, notes: input.notes }), // undefined → store genererar
            matterId: original.matterId,
            amount: -original.amount,
            invoiceType: "CREDIT",
            status: "SENT", // kreditfaktura är "färdig" direkt
            invoiceDate: new Date(),
            creditedInvoiceId: original.id,
          },
        });

        await tx.invoices.update({
          where: { id: original.id },
          data: { status: "CANCELLED" },
        });

        return credit;
      });
    }),

  recordPayment: orgProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        amount: z.number().int().min(1),
        paidAt: z.string(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const inv = await tx.invoices.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { paymentPlan: true, payments: true },
        });
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });

        const payment = await tx.payments.create({
          data: {
            invoiceId: inv.id,
            amount: input.amount,
            paidAt: new Date(input.paidAt),
            note: input.note,
            recordedById: asId<"UserId">(ctx.user.id),
          },
        });

        const paidSum =
          inv.payments.reduce((s: number, p: { amount: number }) => s + p.amount, 0) + input.amount;

        if (isPaymentPlanSettled(inv.amount, paidSum)) {
          await tx.invoices.update({
            where: { id: inv.id },
            data: { status: "PAID" },
          });
          if (inv.paymentPlan) {
            await tx.paymentPlans.update({
              where: { id: inv.paymentPlan.id },
              data: { status: "COMPLETED" },
            });
          }
        }
        return { payment, paidSum, settled: isPaymentPlanSettled(inv.amount, paidSum) };
      });
    }),

  createPaymentPlan: orgProcedure
    .input(
      z.object({
        /** Valfritt klient-genererat id (demo-generator/fixtures) → annars genererar store:n. */
        id: paymentPlanIdSchema.optional(),
        invoiceId: invoiceIdSchema,
        monthlyAmount: z.number().int().min(1),
        dayOfMonth: z.number().int().min(1).max(28),
        startDate: z.string(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const inv = await tx.invoices.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { paymentPlan: true },
        });
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
        if (inv.paymentPlan && inv.paymentPlan.status === "ACTIVE") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "En aktiv avbetalningsplan finns redan för denna faktura.",
          });
        }
        if (inv.status !== "SENT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Endast SENT-fakturor kan få en avbetalningsplan.",
          });
        }

        // Om en gammal CANCELLED-plan finns, ta bort den först — `invoiceId`
        // är @unique på PaymentPlan så vi kan inte ha två rader.
        if (inv.paymentPlan && inv.paymentPlan.status !== "ACTIVE") {
          await tx.paymentPlans.delete({ where: { id: inv.paymentPlan.id } });
        }

        const plan = await tx.paymentPlans.create({
          data: {
            ...omitUndefined({ id: input.id, notes: input.notes }), // undefined → store genererar
            invoiceId: inv.id,
            monthlyAmount: input.monthlyAmount,
            dayOfMonth: input.dayOfMonth,
            startDate: new Date(input.startDate),
            // Explicit (Prisma schema-default appliceras inte av in-memory-store:n).
            status: "ACTIVE",
          },
        });
        await tx.invoices.update({
          where: { id: inv.id },
          data: { status: "INSTALLMENT_PLAN" },
        });
        return plan;
      });
    }),

  cancelPaymentPlan: orgProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const plan = await tx.paymentPlans.findFirst({
          where: {
            id: input.planId,
            invoice: { matter: { organizationId: ctx.orgId } },
          },
        });
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.paymentPlans.update({
          where: { id: plan.id },
          data: { status: "CANCELLED" },
        });
        await tx.invoices.update({
          where: { id: plan.invoiceId },
          data: { status: "SENT" },
        });
        return { ok: true };
      });
    }),

  /** Manuell statusändring för DRAFT→SENT, SENT→CANCELLED, SENT→BAD_DEBT. */
  setStatus: orgProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        status: z.enum(["SENT", "CANCELLED", "BAD_DEBT"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.dataStore.invoices.findFirst({
        where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
      });
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.invoices.update({
        where: { id: inv.id },
        data: { status: input.status },
      });
    }),
});
