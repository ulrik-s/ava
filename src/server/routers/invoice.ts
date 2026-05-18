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
import { computeFinalInvoiceBreakdown, isPaymentPlanSettled } from "@/lib/invoice-calc";
import { emit } from "../events/emit";

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
      ctx.prisma.invoice.findMany({
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
      const inv = await ctx.prisma.invoice.findFirst({
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
        matterId: z.string(),
        amount: z.number().int().min(1),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await ctx.prisma.matter.findFirst({
        where: { id: input.matterId, organizationId: ctx.orgId },
      });
      if (!matter) throw new TRPCError({ code: "NOT_FOUND" });
      const invoice = await ctx.prisma.invoice.create({
        data: {
          matterId: input.matterId,
          amount: input.amount,
          invoiceType: "ACCONTO",
          status: "DRAFT",
          invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          notes: input.notes,
        },
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
        matterId: z.string(),
        timeEntryIds: z.array(z.string()),
        expenseIds: z.array(z.string()),
        accontoInvoiceIds: z.array(z.string()).default([]),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const matter = await tx.matter.findFirst({
          where: { id: input.matterId, organizationId: ctx.orgId },
        });
        if (!matter) throw new TRPCError({ code: "NOT_FOUND" });

        // Hämta och validera time entries
        const timeEntries = input.timeEntryIds.length
          ? await tx.timeEntry.findMany({
              where: {
                id: { in: input.timeEntryIds },
                matterId: input.matterId,
                invoiceId: null,
              },
              include: { user: { select: { hourlyRate: true } } },
            })
          : [];
        if (timeEntries.length !== input.timeEntryIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Några tidsposter är redan fakturerade eller tillhör annat ärende.",
          });
        }

        const expenses = input.expenseIds.length
          ? await tx.expense.findMany({
              where: {
                id: { in: input.expenseIds },
                matterId: input.matterId,
                invoiceId: null,
              },
            })
          : [];
        if (expenses.length !== input.expenseIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Några utlägg är redan fakturerade eller tillhör annat ärende.",
          });
        }

        // Validera accontos: måste tillhöra samma ärende, vara ACCONTO, och
        // inte redan vara avdragna på en tidigare FINAL.
        const accontos = input.accontoInvoiceIds.length
          ? await tx.invoice.findMany({
              where: {
                id: { in: input.accontoInvoiceIds },
                matterId: input.matterId,
                invoiceType: "ACCONTO",
                deductedOnFinals: { none: {} },
              },
            })
          : [];
        if (accontos.length !== input.accontoInvoiceIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Några acconto-fakturor är redan avdragna eller tillhör annat ärende.",
          });
        }

        const breakdown = computeFinalInvoiceBreakdown(
          timeEntries.map((t) => ({
            minutes: t.minutes,
            hourlyRate: t.user.hourlyRate ?? 0,
          })),
          expenses.map((e) => ({ amount: e.amount, billable: e.billable })),
          accontos.map((a) => ({ id: a.id, amount: a.amount })),
        );

        const invoice = await tx.invoice.create({
          data: {
            matterId: input.matterId,
            amount: breakdown.grossAmount,
            invoiceType: "FINAL",
            status: "DRAFT",
            invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            notes: input.notes,
            timeEntries: { connect: timeEntries.map((t) => ({ id: t.id })) },
            expenses: { connect: expenses.map((e) => ({ id: e.id })) },
            accontoDeductions: {
              create: accontos.map((a) => ({ accontoInvoiceId: a.id })),
            },
          },
        });
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
        invoiceId: z.string(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const original = await tx.invoice.findFirst({
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
          await tx.paymentPlan.update({
            where: { id: original.paymentPlan.id },
            data: { status: "CANCELLED" },
          });
        }

        const credit = await tx.invoice.create({
          data: {
            matterId: original.matterId,
            amount: -original.amount,
            invoiceType: "CREDIT",
            status: "SENT", // kreditfaktura är "färdig" direkt
            invoiceDate: new Date(),
            notes: input.notes,
            creditedInvoiceId: original.id,
          },
        });

        await tx.invoice.update({
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
      return ctx.prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { paymentPlan: true, payments: true },
        });
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });

        const payment = await tx.payment.create({
          data: {
            invoiceId: inv.id,
            amount: input.amount,
            paidAt: new Date(input.paidAt),
            note: input.note,
            recordedById: ctx.user.id,
          },
        });

        const paidSum =
          inv.payments.reduce((s, p) => s + p.amount, 0) + input.amount;

        if (isPaymentPlanSettled(inv.amount, paidSum)) {
          await tx.invoice.update({
            where: { id: inv.id },
            data: { status: "PAID" },
          });
          if (inv.paymentPlan) {
            await tx.paymentPlan.update({
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
        invoiceId: z.string(),
        monthlyAmount: z.number().int().min(1),
        dayOfMonth: z.number().int().min(1).max(28),
        startDate: z.string(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.findFirst({
          where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
          include: { paymentPlan: true },
        });
        if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
        if (inv.paymentPlan) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Avbetalningsplan finns redan för denna faktura.",
          });
        }
        if (inv.status !== "SENT") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Endast SENT-fakturor kan få en avbetalningsplan.",
          });
        }

        const plan = await tx.paymentPlan.create({
          data: {
            invoiceId: inv.id,
            monthlyAmount: input.monthlyAmount,
            dayOfMonth: input.dayOfMonth,
            startDate: new Date(input.startDate),
            notes: input.notes,
          },
        });
        await tx.invoice.update({
          where: { id: inv.id },
          data: { status: "INSTALLMENT_PLAN" },
        });
        return plan;
      });
    }),

  cancelPaymentPlan: orgProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const plan = await tx.paymentPlan.findFirst({
          where: {
            id: input.planId,
            invoice: { matter: { organizationId: ctx.orgId } },
          },
        });
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.paymentPlan.update({
          where: { id: plan.id },
          data: { status: "CANCELLED" },
        });
        await tx.invoice.update({
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
      const inv = await ctx.prisma.invoice.findFirst({
        where: { id: input.invoiceId, matter: { organizationId: ctx.orgId } },
      });
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.invoice.update({
        where: { id: inv.id },
        data: { status: input.status },
      });
    }),
});
