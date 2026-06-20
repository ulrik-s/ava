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
import {
  computeDueReminders,
  type PlanForScan,
} from "@/lib/shared/payment-reminders";
import { paymentPlanStatusSchema, reminderTypeSchema, type Invoice, type PaymentPlan } from "@/lib/shared/schemas";
import { asId, paymentPlanIdSchema, paymentPlanReminderIdSchema } from "@/lib/shared/schemas/ids";
import { emit } from "../events/emit";
import type {
  JoinedPaymentPlan, JoinedPaymentPlanWithReminders,
} from "../repositories/payment-plan-repository";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

/** Lokalt alias för den joinade plan-formen repot returnerar. */
type JoinedPlan = JoinedPaymentPlanWithReminders;

function sumPaidOre(payments?: Array<{ amount?: number }>): number {
  return (payments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

type PlanMatter = NonNullable<NonNullable<JoinedPlan["invoice"]>["matter"]>;

/** KLIENT-kontaktens namn/email för påminnelse-payloaden (tom om saknas). */
function resolveRecipient(matter: PlanMatter | null): { email: string; name: string } {
  const client = matter?.contacts?.[0]?.contact;
  return { email: client?.email ?? "", name: client?.name ?? "" };
}

/** Ärende-fälten scannern behöver (tomma om ärendet saknas). */
function scanMatterFields(m: PlanMatter | null): { matterId: string; matterNumber: string; matterTitle: string } {
  return { matterId: m?.id ?? "", matterNumber: m?.matterNumber ?? "", matterTitle: m?.title ?? "" };
}

function toPlanForScan(p: JoinedPlan): PlanForScan {
  const inv = p.invoice;
  const matter = inv?.matter ?? null;
  const recipient = resolveRecipient(matter);
  return {
    planId: p.id,
    status: p.status,
    monthlyAmount: p.monthlyAmount,
    dayOfMonth: p.dayOfMonth,
    startDate: new Date(p.startDate),
    invoiceTotalOre: inv?.amount ?? 0,
    paidOre: sumPaidOre(inv?.payments),
    ...scanMatterFields(matter),
    recipientEmail: recipient.email,
    recipientName: recipient.name,
  };
}

/** Sökbar text för en plan-rad: ärendenr + titel + klientnamn + anteckningar. */
function planHaystack(p: JoinedPaymentPlan): string {
  const matter = p.invoice?.matter ?? null;
  return [
    matter?.matterNumber ?? "",
    matter?.title ?? "",
    resolveRecipient(matter).name,
    (p as { notes?: string | null }).notes ?? "",
  ].join(" ").toLowerCase();
}

export const paymentPlanRouter = router({
  list: orgProcedure
    .input(
      z.object({
        status: paymentPlanStatusSchema.optional(),
        search: z.string().optional(),
      }).optional(),
    )
    // Migrerad till repository-sömmen (ADR 0020): listForOrg kapslar in
    // org-scoping + den joinade faktura/ärende/KLIENT/betalnings-formen.
    .query(async ({ ctx, input }) => {
      const plans = await ctx.repos.paymentPlans.listForOrg(ctx.orgId, input?.status);
      if (!input?.search) return plans;
      const needle = input.search.toLowerCase();
      return plans.filter((p) => planHaystack(p).includes(needle));
    }),

  getById: orgProcedure
    .input(z.object({ id: paymentPlanIdSchema }))
    .query(async ({ ctx, input }) => {
      const plan = await ctx.repos.paymentPlans.getByIdWithDetails(input.id, ctx.orgId);
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
    .input(z.object({ planId: paymentPlanIdSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.repos.transaction(async (tx) => {
        const plan = await tx.paymentPlans.getByIdInOrg(input.planId, ctx.user.organizationId);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        if (plan.status !== "ACTIVE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Endast aktiva planer kan avbrytas" });
        }
        await tx.paymentPlans.update(plan.id, { status: "CANCELLED" } satisfies Partial<PaymentPlan>);
        await tx.invoices.update(plan.invoiceId, { status: "SENT" } satisfies Partial<Invoice>);
        return { ok: true };
      });
    }),

  /**
   * Logga en utskickad påminnelse för en plan (DUE/OVERDUE för en viss månad).
   * Org-scopas via planens invoice. `sentAt`/`id` är valfria (demo-generator/
   * fixtures, ADR 0003) — annars now() resp store-genererat id.
   */
  recordReminder: orgProcedure
    .input(
      z.object({
        id: paymentPlanReminderIdSchema.optional(),
        planId: paymentPlanIdSchema,
        dueMonth: z.string().regex(/^\d{4}-\d{2}$/),
        type: reminderTypeSchema,
        sentAt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.repos.paymentPlans.getByIdInOrg(input.planId, ctx.orgId);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.paymentPlanReminders.create({
        ...(input.id ? { id: asId<"PaymentPlanReminderId">(input.id) } : {}),
        planId: asId<"PaymentPlanId">(input.planId),
        dueMonth: input.dueMonth,
        type: input.type,
        sentAt: input.sentAt ? new Date(input.sentAt) : new Date(),
      });
    }),

  /**
   * Payment-scan (#23): scanna org:ens aktiva planer och generera DUE/OVERDUE-
   * påminnelser. Ren beslutslogik i `computeDueReminders`; här gör vi I/O —
   * hämtar planer (joinade), loggar varje påminnelse (`paymentPlanReminders`)
   * och emittar `payment.due`/`payment.overdue` (via `emit`, read-only-säkert).
   * Idempotent: redan loggade (plan, månad, typ) hoppas över i kärnan.
   *
   * `asOf` (valfri ISO) injicerar "nu" för deterministiska tester/fixtures
   * (samma mönster som `recordReminder.sentAt`, ADR 0003); annars `new Date()`.
   */
  scanDueReminders: orgProcedure
    .input(z.object({ asOf: z.string().datetime().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const now = input?.asOf ? new Date(input.asOf) : new Date();
      const plans = await ctx.repos.paymentPlans.listActiveForScan(ctx.orgId);

      const logged = plans.flatMap((p) =>
        (p.reminders ?? []).map((r) => ({ planId: p.id, dueMonth: r.dueMonth, type: r.type })),
      );
      const planned = computeDueReminders(plans.map(toPlanForScan), now, logged);

      for (const r of planned) {
        await ctx.repos.paymentPlanReminders.create({
          planId: asId<"PaymentPlanId">(r.planId), dueMonth: r.dueMonth, type: r.type, sentAt: now,
        });
        if (r.type === "DUE") await emit.paymentDue(ctx, r.payload, r.matterId);
        else await emit.paymentOverdue(ctx, r.payload, r.matterId);
      }

      return {
        scanned: plans.length,
        planned: planned.length,
        due: planned.filter((p) => p.type === "DUE").length,
        overdue: planned.filter((p) => p.type === "OVERDUE").length,
      };
    }),
});
