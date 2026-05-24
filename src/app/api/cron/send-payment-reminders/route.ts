/**
 * @deprecated Sedan Fas 1.5 (2026-05-18) ersätts den här endpointen av
 * regelmotor-driven payment-scan:
 *
 *   1. `/api/cron/scheduler-tick` triggas av extern cron
 *   2. Regeln `_org/daily-payment-scan` (enabled per byrå) emittar
 *      `system.payment_scan_requested`
 *   3. `payment-scan-service.ts` reagerar och emittar `payment.due` /
 *      `payment.overdue` per plan
 *   4. Reglerna `_org/send-payment-due-mail` och `_org/send-payment-overdue-mail`
 *      skickar respektive mall via `email.send`-step
 *
 * Den här endpoint:n är kvar för bakåtkompatibilitet under en
 * övergångsperiod. När alla byråer har aktiverat de fyra reglerna
 * (daily-payment-scan + 1b + 1c) kan filen raderas.
 *
 * Cron-endpoint: skickar månads- och påminnelsebrev för aktiva
 * avbetalningsplaner. Körs dagligen av extern schemaläggare (systemd-timer,
 * k8s CronJob, Vercel Cron, macOS `launchd`, whatever).
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 *
 * Idempotens: varje utskick loggas i `PaymentPlanReminder` med unique
 * `[planId, dueMonth, type]`. Om cron:en körs två gånger samma dag skickas
 * inget dubbelt.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { sendPaymentDue, sendPaymentOverdue, type PaymentReminderContext } from "@/server/services/email";
import { monthKey, planHasStarted } from "@/client/lib/invoice-calc";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async function 'POST' has a complexity of 11. Maximum allowed is 8.)
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET är inte satt på servern." },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const currentMonth = monthKey(today);
  const day = today.getUTCDate();

  const plans = await prisma.paymentPlan.findMany({
    where: { status: "ACTIVE", invoice: { status: "INSTALLMENT_PLAN" } },
    include: {
      invoice: {
        include: {
          matter: {
            include: {
              organization: true,
              contacts: {
                where: { role: "KLIENT" },
                include: { contact: true },
                take: 1,
              },
            },
          },
          payments: true,
        },
      },
    },
  });

  let dueSent = 0;
  let overdueSent = 0;
  let skippedNoEmail = 0;

  for (const plan of plans) {
    if (!planHasStarted(plan.startDate, today)) continue;

    const ctx = buildReminderContext(plan);
    if (!ctx) {
      console.warn(`[cron] Plan ${plan.id}: klient saknar e-postadress, skippar utskick.`);
      skippedNoEmail++;
      continue;
    }

    if (day === plan.dayOfMonth) {
      if (await trySendDue(plan.id, ctx, currentMonth)) dueSent++;
    }
    if (day === plan.dayOfMonth + 10) {
      const hasPaidThisMonth = plan.invoice.payments.some((p) => monthKey(p.paidAt) === currentMonth);
      if (!hasPaidThisMonth && await trySendOverdue(plan.id, ctx, currentMonth)) overdueSent++;
    }
  }

  return NextResponse.json({
    ok: true,
    plansChecked: plans.length,
    dueSent,
    overdueSent,
    skippedNoEmail,
  });
}

type PlanWithIncludes = Awaited<ReturnType<typeof prisma.paymentPlan.findMany>>[number] & {
  invoice: {
    amount: number;
    payments: Array<{ amount: number; paidAt: Date }>;
    matter: {
      matterNumber: string;
      title: string;
      organization: { name: string; email: string | null; bankgiro: string | null };
      contacts: Array<{ contact: { email: string | null; name: string } }>;
    };
  };
};

function buildReminderContext(plan: PlanWithIncludes): PaymentReminderContext | null {
  const clientLink = plan.invoice.matter.contacts[0];
  const email = clientLink?.contact.email;
  if (!email) return null;
  const name = clientLink?.contact.name ?? "Klient";
  const paidSum = plan.invoice.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, plan.invoice.amount - paidSum);
  const org = plan.invoice.matter.organization;
  return {
    recipientEmail: email,
    recipientName: name,
    matterNumber: plan.invoice.matter.matterNumber,
    matterTitle: plan.invoice.matter.title,
    invoiceAmount: plan.invoice.amount,
    monthlyAmount: plan.monthlyAmount,
    dayOfMonth: plan.dayOfMonth,
    remainingAmount: remaining,
    organizationName: org.name,
    organizationContact: org.email ?? undefined,
    bankgiro: org.bankgiro ?? undefined,
  };
}

async function trySendDue(planId: string, ctx: PaymentReminderContext, currentMonth: string): Promise<boolean> {
  const alreadySent = await prisma.paymentPlanReminder.findUnique({
    where: { planId_dueMonth_type: { planId, dueMonth: currentMonth, type: "DUE" } },
  });
  if (alreadySent) return false;
  try {
    await sendPaymentDue(ctx);
    await prisma.paymentPlanReminder.create({
      data: { planId, dueMonth: currentMonth, type: "DUE" },
    });
    return true;
  } catch (e) {
    console.error(`[cron] DUE-mail misslyckades för plan ${planId}:`, e);
    return false;
  }
}

async function trySendOverdue(planId: string, ctx: PaymentReminderContext, currentMonth: string): Promise<boolean> {
  const alreadySent = await prisma.paymentPlanReminder.findUnique({
    where: { planId_dueMonth_type: { planId, dueMonth: currentMonth, type: "OVERDUE" } },
  });
  if (alreadySent) return false;
  try {
    await sendPaymentOverdue(ctx);
    await prisma.paymentPlanReminder.create({
      data: { planId, dueMonth: currentMonth, type: "OVERDUE" },
    });
    return true;
  } catch (e) {
    console.error(`[cron] OVERDUE-mail misslyckades för plan ${planId}:`, e);
    return false;
  }
}
