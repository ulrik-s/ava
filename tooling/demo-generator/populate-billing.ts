/**
 * `populateBilling` — driver fakturerings-FLÖDENA via tRPC (ADR-beslut "1a").
 *
 * Istället för att skriva pre-bakade faktura-/betalnings-rader kör vi de
 * riktiga mutationerna (createAcconto → recordPayment → createFinal →
 * createPaymentPlan → createCredit). Fakturorna blir därför ORGANISKA:
 * belopp beräknas från de obetalda tids-/utläggsposterna, fakturanummer +
 * id:n auto-genereras. Det validerar faktureringsmotorn på riktigt.
 *
 * Scenariot speglar seedens dokumenterade variation (rikt läge): acconto-
 * avdrag, betalda finals, flera aktiva avbetalningsplaner med delbetalningar,
 * en slutförd plan, en avbruten plan och en kreditfaktura.
 */

import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";
import { demoFinalInvoiceId, demoAccontoInvoiceId, demoCreditInvoiceId, demoPaymentPlanId } from "../scripts/demo-billing-ids";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCaller = any;

export interface BillingResult {
  invoices: number;
  payments: number;
  paymentPlans: number;
  credits: number;
  reminders: number;
  writeOffs: number;
}

interface Ctx {
  c: AnyCaller;
  res: BillingResult;
  time: Map<string, string[]>;
  exp: Map<string, string[]>;
}

function arr(seed: SeedDataset, key: keyof SeedDataset): Row[] {
  return ((seed[key] as Row[] | undefined) ?? []);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function groupIds(rows: Row[], key: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const list = map.get(k) ?? [];
    list.push(String(r.id));
    map.set(k, list);
  }
  return map;
}

function idsOf(ctx: Ctx, matterId: string): { timeEntryIds: string[]; expenseIds: string[] } {
  return { timeEntryIds: ctx.time.get(matterId) ?? [], expenseIds: ctx.exp.get(matterId) ?? [] };
}

/** createFinal från matterns obetalda poster + sätt SENT. Returnerar {id, amount}. */
async function finalSent(ctx: Ctx, matterId: string, daysAgo: number, accontoInvoiceIds: string[] = []): Promise<{ id: string; amount: number }> {
  const { timeEntryIds, expenseIds } = idsOf(ctx, matterId);
  // createFinal returnerar { invoice, breakdown } — plocka ut fakturan.
  const { invoice } = await ctx.c.invoice.createFinal({
    id: demoFinalInvoiceId(matterId),
    matterId, timeEntryIds, expenseIds, accontoInvoiceIds,
    invoiceDate: isoDaysAgo(daysAgo), dueDate: isoDaysAgo(daysAgo - 30),
  });
  ctx.res.invoices++;
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  return { id: invoice.id, amount: invoice.amount };
}

async function scenarioPaid(ctx: Ctx, matterId: string | undefined, daysAgo: number): Promise<void> {
  if (!matterId) return;
  const inv = await finalSent(ctx, matterId, daysAgo);
  if (inv.amount <= 0) return;
  await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: inv.amount, paidAt: isoDaysAgo(daysAgo - 20), note: "Full betalning" });
  ctx.res.payments++;
}

/** Logga `months` DUE-påminnelser för de senaste månaderna (historik). */
async function addReminders(ctx: Ctx, planId: string, months: number): Promise<void> {
  for (let m = months; m >= 1; m--) {
    const due = new Date();
    due.setMonth(due.getMonth() - m);
    const dueMonth = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}`;
    await ctx.c.paymentPlan.recordReminder({ planId, dueMonth, type: "DUE", sentAt: new Date(due.getFullYear(), due.getMonth(), 10).toISOString() });
    ctx.res.reminders++;
  }
}

async function scenarioActivePlan(ctx: Ctx, matterId: string | undefined, daysAgo: number, monthsPaid: number): Promise<void> {
  if (!matterId) return;
  const inv = await finalSent(ctx, matterId, daysAgo);
  if (inv.amount < 5) return;
  const monthly = Math.ceil(inv.amount / 5); // 5 delbetalningar → delbetalda planer förblir ACTIVE
  const plan = await ctx.c.invoice.createPaymentPlan({ id: demoPaymentPlanId(matterId), invoiceId: inv.id, monthlyAmount: monthly, dayOfMonth: 15, startDate: isoDaysAgo(daysAgo - 5) });
  ctx.res.paymentPlans++;
  await addReminders(ctx, plan.id, Math.min(2, monthsPaid + 1));
  for (let m = 0; m < monthsPaid; m++) {
    await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: monthly, paidAt: isoDaysAgo(daysAgo - 30 - m * 30), note: `Avbetalning ${m + 1}` });
    ctx.res.payments++;
  }
}

async function scenarioCompletedPlan(ctx: Ctx, matterId: string | undefined, daysAgo: number): Promise<void> {
  if (!matterId) return;
  const inv = await finalSent(ctx, matterId, daysAgo);
  if (inv.amount <= 0) return;
  const plan = await ctx.c.invoice.createPaymentPlan({ id: demoPaymentPlanId(matterId), invoiceId: inv.id, monthlyAmount: Math.ceil(inv.amount / 3), dayOfMonth: 1, startDate: isoDaysAgo(daysAgo - 5) });
  ctx.res.paymentPlans++;
  await addReminders(ctx, plan.id, 6); // hel historik för slutförd plan
  // Full inbetalning → recordPayment auto-completar plan + sätter PAID.
  await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: inv.amount, paidAt: isoDaysAgo(daysAgo - 10), note: "Slutbetalning" });
  ctx.res.payments++;
}

async function scenarioCancelledPlan(ctx: Ctx, matterId: string | undefined, daysAgo: number): Promise<void> {
  if (!matterId) return;
  const inv = await finalSent(ctx, matterId, daysAgo);
  if (inv.amount <= 0) return;
  const plan = await ctx.c.invoice.createPaymentPlan({ id: demoPaymentPlanId(matterId), invoiceId: inv.id, monthlyAmount: Math.ceil(inv.amount / 6), dayOfMonth: 28, startDate: isoDaysAgo(daysAgo - 5), notes: "Avbruten på klientens begäran" });
  ctx.res.paymentPlans++;
  await ctx.c.invoice.cancelPaymentPlan({ planId: plan.id });
}

async function scenarioCredit(ctx: Ctx, matterId: string | undefined, daysAgo: number): Promise<void> {
  if (!matterId) return;
  const inv = await finalSent(ctx, matterId, daysAgo);
  await ctx.c.invoice.createCredit({ id: demoCreditInvoiceId(matterId), invoiceId: inv.id, notes: "Kreditering — felaktig fakturering" });
  ctx.res.invoices++; // kreditfakturan
  ctx.res.credits++;
}

async function scenarioAcconto(ctx: Ctx, matterId: string | undefined, daysAgo: number): Promise<void> {
  if (!matterId) return;
  const acconto = await ctx.c.invoice.createAcconto({ id: demoAccontoInvoiceId(matterId), matterId, amount: 50_000, invoiceDate: isoDaysAgo(daysAgo + 20), dueDate: isoDaysAgo(daysAgo - 10), notes: "Förskott" });
  ctx.res.invoices++;
  await ctx.c.invoice.setStatus({ invoiceId: acconto.id, status: "SENT" });
  await finalSent(ctx, matterId, daysAgo, [acconto.id]); // final med acconto-avdrag
}

async function scenarioDraft(ctx: Ctx, matterId: string, daysAgo: number): Promise<void> {
  const { timeEntryIds, expenseIds } = idsOf(ctx, matterId);
  await ctx.c.invoice.createFinal({ id: demoFinalInvoiceId(matterId), matterId, timeEntryIds, expenseIds, accontoInvoiceIds: [], invoiceDate: isoDaysAgo(daysAgo) });
  ctx.res.invoices++; // lämnas DRAFT
}

/** Delbetald faktura → konstaterad kundförlust på återstoden (ADR 0007). */
async function scenarioWriteOff(ctx: Ctx, matterId: string | undefined, daysAgo: number): Promise<void> {
  if (!matterId) return;
  const inv = await finalSent(ctx, matterId, daysAgo);
  const part = Math.floor(inv.amount / 4);
  if (part > 0) {
    await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: part, paidAt: isoDaysAgo(daysAgo - 15), note: "Delbetalning" });
    ctx.res.payments++;
  }
  // writeOff skriver av återstoden → daterad WriteOff-post + härledd BAD_DEBT.
  await ctx.c.invoice.writeOff({ invoiceId: inv.id, reason: "Klient försatt i konkurs", writtenOffAt: isoDaysAgo(daysAgo - 30) });
  ctx.res.writeOffs++;
}

export async function populateBilling(caller: GeneratorCaller, seed: SeedDataset): Promise<BillingResult> {
  const ctx: Ctx = {
    c: caller as AnyCaller,
    res: { invoices: 0, payments: 0, paymentPlans: 0, credits: 0, reminders: 0, writeOffs: 0 },
    time: groupIds(arr(seed, "timeEntries"), "matterId"),
    exp: groupIds(arr(seed, "expenses"), "matterId"),
  };
  // Bara ärenden med fakturerbart arbete (annars amount = 0).
  const billable = arr(seed, "matters")
    .map((m) => String(m.id))
    .filter((id) => ctx.time.has(id) || ctx.exp.has(id));

  let i = 0;
  const next = (): string | undefined => billable[i++];

  await scenarioAcconto(ctx, next(), 75); // acconto-avdrag + SENT final
  await scenarioPaid(ctx, next(), 60);
  await scenarioPaid(ctx, next(), 50);
  await scenarioPaid(ctx, next(), 40);
  await scenarioActivePlan(ctx, next(), 30, 1); // aktiva planer i olika faser
  await scenarioActivePlan(ctx, next(), 90, 3);
  await scenarioActivePlan(ctx, next(), 120, 4);
  await scenarioActivePlan(ctx, next(), 60, 2);
  await scenarioActivePlan(ctx, next(), 45, 1);
  await scenarioCompletedPlan(ctx, next(), 200);
  await scenarioCancelledPlan(ctx, next(), 55);
  await scenarioCredit(ctx, next(), 35);
  await scenarioWriteOff(ctx, next(), 80); // konstaterad kundförlust (ADR 0007)
  for (const id of billable.slice(i)) await scenarioDraft(ctx, id, 20); // resten → DRAFT

  return ctx.res;
}
