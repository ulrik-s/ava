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
  type ReminderKind,
} from "@/lib/shared/payment-reminders";
import { paymentPlanStatusSchema, reminderTypeSchema, type PaymentPlanStatus } from "@/lib/shared/schemas";
import { emit } from "../events/emit";
import { router, protectedProcedure, orgProcedure, TRPCError } from "../trpc";

type Plan = { id: string; status: PaymentPlanStatus; invoiceId: string };

/** Joinad plan-rad (IDataStore:s query-yta är otypad — vi formar lokalt). */
interface JoinedPlan {
  id: string;
  status: string;
  monthlyAmount: number;
  dayOfMonth: number;
  startDate: Date | string;
  invoice?: {
    amount?: number;
    payments?: Array<{ amount?: number }>;
    matter?: {
      id?: string;
      matterNumber?: string;
      title?: string;
      contacts?: Array<{ contact?: { name?: string; email?: string | null } }>;
    };
  };
  reminders?: Array<{ dueMonth: string; type: ReminderKind }>;
}

function sumPaidOre(payments?: Array<{ amount?: number }>): number {
  return (payments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

type Matter = NonNullable<NonNullable<JoinedPlan["invoice"]>["matter"]>;

/** KLIENT-kontaktens namn/email för påminnelse-payloaden (tom om saknas). */
function resolveRecipient(matter: Matter): { email: string; name: string } {
  const client = matter.contacts?.[0]?.contact ?? {};
  return { email: client.email ?? "", name: client.name ?? "" };
}

function toPlanForScan(p: JoinedPlan): PlanForScan {
  const inv = p.invoice ?? {};
  const matter: Matter = inv.matter ?? {};
  const recipient = resolveRecipient(matter);
  return {
    planId: p.id,
    status: p.status,
    monthlyAmount: p.monthlyAmount,
    dayOfMonth: p.dayOfMonth,
    startDate: new Date(p.startDate),
    invoiceTotalOre: inv.amount ?? 0,
    paidOre: sumPaidOre(inv.payments),
    matterId: matter.id ?? "",
    matterNumber: matter.matterNumber ?? "",
    matterTitle: matter.title ?? "",
    recipientEmail: recipient.email,
    recipientName: recipient.name,
  };
}

/** Sökbar text för en plan-rad: ärendenr + titel + klientnamn + anteckningar. */
function planHaystack(p: Record<string, unknown>): string {
  const plan = p as unknown as JoinedPlan;
  const matter: Matter = plan.invoice?.matter ?? {};
  return [
    matter.matterNumber ?? "",
    matter.title ?? "",
    resolveRecipient(matter).name,
    (p.notes as string | null) ?? "",
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
              // + writeOffs så utestående kan beräknas via ledgern (ADR 0007).
              writeOffs: true,
            },
          },
        },
      });
      if (!input?.search) return plans;
      const needle = input.search.toLowerCase();
      return plans.filter((p: Record<string, unknown>) => planHaystack(p).includes(needle));
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
              writeOffs: true,
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

  /**
   * Logga en utskickad påminnelse för en plan (DUE/OVERDUE för en viss månad).
   * Org-scopas via planens invoice. `sentAt`/`id` är valfria (demo-generator/
   * fixtures, ADR 0003) — annars now() resp store-genererat id.
   */
  recordReminder: orgProcedure
    .input(
      z.object({
        id: z.string().optional(),
        planId: z.string(),
        dueMonth: z.string().regex(/^\d{4}-\d{2}$/),
        type: reminderTypeSchema,
        sentAt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.dataStore.paymentPlans.findFirst({
        where: { id: input.planId, invoice: { matter: { organizationId: ctx.orgId } } },
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.dataStore.paymentPlanReminders.create({
        data: {
          id: input.id,
          planId: input.planId,
          dueMonth: input.dueMonth,
          type: input.type,
          sentAt: input.sentAt ? new Date(input.sentAt) : new Date(),
        },
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
      const plans = await ctx.dataStore.paymentPlans.findMany({
        where: { status: "ACTIVE", invoice: { matter: { organizationId: ctx.orgId } } },
        include: {
          invoice: {
            include: {
              payments: true,
              matter: {
                include: {
                  contacts: {
                    where: { role: "KLIENT" },
                    include: { contact: { select: { id: true, name: true, email: true } } },
                    take: 1,
                  },
                },
              },
            },
          },
          reminders: true,
        },
      }) as unknown as JoinedPlan[];

      const logged = plans.flatMap((p) =>
        (p.reminders ?? []).map((r) => ({ planId: p.id, dueMonth: r.dueMonth, type: r.type })),
      );
      const planned = computeDueReminders(plans.map(toPlanForScan), now, logged);

      for (const r of planned) {
        await ctx.dataStore.paymentPlanReminders.create({
          data: { planId: r.planId, dueMonth: r.dueMonth, type: r.type, sentAt: now },
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
