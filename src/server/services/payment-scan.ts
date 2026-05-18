/**
 * Payment-scan: hittar aktiva avbetalningsplaner som har förfallodag idag
 * (för DUE-mail) eller är 10 dagar försenade (för OVERDUE-mail) och emittar
 * `payment.due` / `payment.overdue`-events per plan.
 *
 * Designprincip (Fas 1.5 — migration från hardcoded cron):
 *   - Den komplexa SQL-frågan (joins över plan/invoice/matter/payments) bor
 *     kvar i kod — för komplext att uttrycka som rule-step.
 *   - Resultatet emittas som **events** istället för att direkt skicka mail.
 *   - Två regler reagerar på events och skickar respektive mail-mall.
 *
 * Idempotens: `payload.idempotencyKey` är `<planId>:<dueMonth>:<DUE|OVERDUE>`
 * och används av `email.send`-stegets idempotency-check.
 *
 * Triggas typiskt av en schemalagd regel `_org/daily-payment-scan` som
 * emittar `system.payment_scan_requested`. Den här service:n lyssnar på det
 * eventet och utför scannen för anropande byrå.
 */

import type { PrismaClient } from "@prisma/client";
import type { IDataStore } from "../data-store/IDataStore";
import { monthKey, planHasStarted } from "@/lib/invoice-calc";

export interface ScanResult {
  organizationId: string;
  plansChecked: number;
  dueEmitted: number;
  overdueEmitted: number;
  skippedNoEmail: number;
}

export async function runPaymentScan(
  prisma: PrismaClient,
  dataStore: IDataStore,
  organizationId: string,
  today: Date = new Date(),
): Promise<ScanResult> {
  const currentMonth = monthKey(today);
  const day = today.getUTCDate();

  const plans = await prisma.paymentPlan.findMany({
    where: {
      status: "ACTIVE",
      invoice: {
        status: "INSTALLMENT_PLAN",
        matter: { organizationId },
      },
    },
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

  let dueEmitted = 0;
  let overdueEmitted = 0;
  let skippedNoEmail = 0;

  for (const plan of plans) {
    if (!planHasStarted(plan.startDate, today)) continue;
    const clientLink = plan.invoice.matter.contacts[0];
    const recipientEmail = clientLink?.contact.email;
    if (!recipientEmail) {
      skippedNoEmail++;
      continue;
    }

    const paidSum = plan.invoice.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, plan.invoice.amount - paidSum);
    const org = plan.invoice.matter.organization;
    const basePayload = {
      planId: plan.id,
      invoiceId: plan.invoice.id,
      matterId: plan.invoice.matter.id,
      dueMonth: currentMonth,
      recipientEmail,
      recipientName: clientLink?.contact.name ?? "Klient",
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

    if (day === plan.dayOfMonth) {
      await dataStore.events.emit({
        type: "payment.due",
        source: "system",
        actor: { kind: "system", id: "payment-scan" },
        matterId: plan.invoice.matter.id,
        payload: {
          ...basePayload,
          idempotencyKey: `${plan.id}:${currentMonth}:DUE`,
        },
      });
      dueEmitted++;
    }

    if (day === plan.dayOfMonth + 10) {
      const hasPaidThisMonth = plan.invoice.payments.some(
        (p) => monthKey(p.paidAt) === currentMonth,
      );
      if (!hasPaidThisMonth) {
        await dataStore.events.emit({
          type: "payment.overdue",
          source: "system",
          actor: { kind: "system", id: "payment-scan" },
          matterId: plan.invoice.matter.id,
          payload: {
            ...basePayload,
            idempotencyKey: `${plan.id}:${currentMonth}:OVERDUE`,
          },
        });
        overdueEmitted++;
      }
    }
  }

  await dataStore.events.emit({
    type: "system.payment_scan_completed",
    source: "system",
    actor: { kind: "system", id: "payment-scan" },
    payload: {
      plansChecked: plans.length,
      dueEmitted,
      overdueEmitted,
      skippedNoEmail,
    },
  });

  return {
    organizationId,
    plansChecked: plans.length,
    dueEmitted,
    overdueEmitted,
    skippedNoEmail,
  };
}
