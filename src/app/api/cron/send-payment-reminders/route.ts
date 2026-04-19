/**
 * Cron-endpoint: skickar månads- och påminnelsebrev för aktiva
 * avbetalningsplaner. Körs dagligen av extern schemaläggare (systemd-timer,
 * k8s CronJob, Vercel Cron, macOS `launchd`, whatever).
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>`.
 *
 * Idempotens: varje utskick loggas i `PaymentPlanReminder` med unique
 * `[planId, dueMonth, type]`. Om cron:en körs två gånger samma dag skickas
 * inget dubbelt.
 *
 * Logik per plan (ACTIVE + invoice.status=INSTALLMENT_PLAN):
 *   - Om today.date === plan.dayOfMonth → DUE-mail (om inte redan skickat
 *     denna månad)
 *   - Om today.date === plan.dayOfMonth + 10 OCH ingen betalning registrerad
 *     i denna månad → OVERDUE-mail (om inte redan skickat denna månad)
 *
 * Returnerar JSON med räknare för observability.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { sendPaymentDue, sendPaymentOverdue, type PaymentReminderContext } from "@/server/services/email";
import { monthKey, planHasStarted } from "@/lib/invoice-calc";

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

    const clientLink = plan.invoice.matter.contacts[0];
    const email = clientLink?.contact.email;
    const name = clientLink?.contact.name ?? "Klient";
    if (!email) {
      console.warn(
        `[cron] Plan ${plan.id}: klient saknar e-postadress, skippar utskick.`,
      );
      skippedNoEmail++;
      continue;
    }

    const paidSum = plan.invoice.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, plan.invoice.amount - paidSum);
    const org = plan.invoice.matter.organization;

    const baseCtx: PaymentReminderContext = {
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

    // DUE: förfallodag idag
    if (day === plan.dayOfMonth) {
      const alreadySent = await prisma.paymentPlanReminder.findUnique({
        where: {
          planId_dueMonth_type: { planId: plan.id, dueMonth: currentMonth, type: "DUE" },
        },
      });
      if (!alreadySent) {
        try {
          await sendPaymentDue(baseCtx);
          await prisma.paymentPlanReminder.create({
            data: { planId: plan.id, dueMonth: currentMonth, type: "DUE" },
          });
          dueSent++;
        } catch (e) {
          console.error(`[cron] DUE-mail misslyckades för plan ${plan.id}:`, e);
        }
      }
    }

    // OVERDUE: 10 dgr efter förfall, ingen betalning denna månad
    if (day === plan.dayOfMonth + 10) {
      const hasPaidThisMonth = plan.invoice.payments.some(
        (p) => monthKey(p.paidAt) === currentMonth,
      );
      if (!hasPaidThisMonth) {
        const alreadySent = await prisma.paymentPlanReminder.findUnique({
          where: {
            planId_dueMonth_type: { planId: plan.id, dueMonth: currentMonth, type: "OVERDUE" },
          },
        });
        if (!alreadySent) {
          try {
            await sendPaymentOverdue(baseCtx);
            await prisma.paymentPlanReminder.create({
              data: { planId: plan.id, dueMonth: currentMonth, type: "OVERDUE" },
            });
            overdueSent++;
          } catch (e) {
            console.error(`[cron] OVERDUE-mail misslyckades för plan ${plan.id}:`, e);
          }
        }
      }
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
