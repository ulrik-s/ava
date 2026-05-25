/**
 * `paymentPlanRouter` — listning + detalj-vy för avbetalningsplaner.
 *
 * Tidigare gick alla operationer via `invoiceRouter` (createPaymentPlan,
 * cancelPaymentPlan). Det är fortfarande korrekt arkitekturmässigt —
 * skapande av en plan KRÄVER en invoice-kontext. Men för att kunna
 * lista och hantera planer separat (egen sida i UI:n) behöver vi även:
 *
 *   - `list({ status?, search? })` — alla planer i org, joined med
 *     invoice + matter + klient
 *   - `getById({ id })` — med reminders-historik
 *   - `cancel({ planId })` — tunn delegering så UI:n inte behöver veta
 *     att operationen "egentligen" sitter på invoice-routern
 *
 * Org-scope sker via `invoice.matter.organizationId` — vi äger ingen
 * direkt org-koppling på planen.
 */

import { z } from "zod";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";
import { paymentPlanStatusSchema } from "@/shared/schemas";

type Plan = { id: string; status: string; invoiceId: string };

export const paymentPlanRouter = router({
  list: orgProcedure
    .input(
      z.object({
        status: paymentPlanStatusSchema.optional(),
        search: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const plans = await ctx.dataStore.paymentPlans.findMany({
        where: {
          ...(input?.status ? { status: input.status } : {}),
          invoice: { matter: { organizationId: ctx.orgId } },
        },
        orderBy: { createdAt: "desc" },
        include: {
          invoice: {
            include: {
              matter: {
                include: {
                  contacts: {
                    where: { role: "KLIENT" },
                    include: { contact: { select: { id: true, name: true } } },
                    take: 1,
                  },
                },
              },
              // Inkludera payments så list-vyn kan visa progress (X av Y betalt)
              payments: { orderBy: { paidAt: "desc" } },
            },
          },
        },
      });
      if (!input?.search) return plans;
      const needle = input.search.toLowerCase();
      // eslint-disable-next-line complexity
      return plans.filter((p: Record<string, unknown>) => {
        const inv = p.invoice as { matter?: { matterNumber?: string; title?: string; contacts?: Array<{ contact?: { name?: string } }> } } | undefined;
        const haystack = [
          inv?.matter?.matterNumber ?? "",
          inv?.matter?.title ?? "",
          inv?.matter?.contacts?.[0]?.contact?.name ?? "",
          (p.notes as string | null) ?? "",
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
      });
    }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const plan = await ctx.dataStore.paymentPlans.findFirst({
        where: { id: input.id, invoice: { matter: { organizationId: ctx.orgId } } },
        include: {
          invoice: {
            include: {
              matter: {
                include: {
                  contacts: {
                    where: { role: "KLIENT" },
                    include: { contact: { select: { id: true, name: true } } },
                    take: 1,
                  },
                },
              },
              payments: { orderBy: { paidAt: "desc" } },
            },
          },
          reminders: { orderBy: { sentAt: "desc" } },
        },
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Avbetalningsplan hittades inte" });
      return plan;
    }),

  /**
   * Avbryt en aktiv plan. Speglar `invoiceRouter.cancelPaymentPlan` — vi
   * delegerar inte JS-mässigt (skulle kräva router-cross-call), utan
   * implementerar samma rörelse mot dataStore. Båda endpoints lever sida
   * vid sida tills UI:n migrerat helt hit; ändringar måste göras på båda.
   */
  cancel: protectedProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.dataStore.transaction(async (tx) => {
        const plan = await tx.paymentPlans.findFirst({
          where: {
            id: input.planId,
            invoice: { matter: { organizationId: ctx.user.organizationId } },
          },
        }) as Plan | null;
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        if (plan.status !== "ACTIVE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Endast aktiva planer kan avbrytas" });
        }
        await tx.paymentPlans.update({ where: { id: plan.id }, data: { status: "CANCELLED" } });
        await tx.invoices.update({ where: { id: plan.invoiceId }, data: { status: "SENT" } });
        return { ok: true };
      });
    }),
});
