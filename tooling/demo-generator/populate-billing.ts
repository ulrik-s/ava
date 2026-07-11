/**
 * `populateBilling` — ETT faktureringsflöde per ärende via BillingRun-modellen
 * (#736-konsolidering). Tidigare kördes två parallella pass (legacy
 * `invoice.createFinal` + `billingRun.*`) över samma ärenden → dubbla fakturor.
 * Nu driver vi ENBART billing-run-mutationerna och lägger livscykeln
 * (betalning/plan/kredit/avskrivning) ovanpå — en sammanhängande kedja per ärende.
 *
 * Dispatch per paymentMethod (realistiskt):
 *   PRIVAT/null           → KLIENT-slutfaktura + varierad livscykel (betald,
 *                           aktiv/slutförd/avbruten plan, kredit, avskrivning, draft)
 *   RATTSSKYDD            → klient-aconto + slutfaktura till FÖRSÄKRING (betald)
 *   RATTSHJALP            → klient-aconto + slutfaktura till RÄTTSHJÄLPSMYNDIGHET (betald)
 *   OFFENTLIGT_UPPDRAG    → kostnadsräkning till domstol (varannan dömd m. prutning)
 *   (taxe-ärenden hoppas över — egen brottmålstaxa-väg)
 *
 * Belopp/fakturanummer/OCR genereras organiskt av billing-run-routern (ADR 0012).
 */

import type { BillingRunRecipient } from "@/lib/shared/schemas/enums";
import { demoFinalInvoiceId, demoAccontoInvoiceId, demoCreditInvoiceId, demoPaymentPlanId } from "../scripts/demo-billing-ids";
import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";

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
  kostnadsrakningPending: number;
  kostnadsrakningSent: number;
}

interface Ctx {
  c: AnyCaller;
  res: BillingResult;
}

/** En skapad slutfaktura. `matterId` bärs med så plan-/kredit-id:n blir deterministiska (uuidv5 på matterId). */
type FinalInv = { id: string; amount: number; matterId: string };

const BILLING_RUN_RECIPIENT: Record<string, BillingRunRecipient> = {
  RATTSSKYDD: "FORSAKRING",
  RATTSHJALP: "RATTSHJALPSMYNDIGHET",
};

function arr(seed: SeedDataset, key: keyof SeedDataset): Row[] {
  return ((seed[key] as Row[] | undefined) ?? []);
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hasWork(seed: SeedDataset, matterId: string): boolean {
  const has = (key: keyof SeedDataset): boolean => arr(seed, key).some((r) => String(r.matterId) === matterId);
  return has("timeEntries") || has("expenses");
}

/** Klient-aconto (rättsskydd/-hjälp) → returnerar billing-run-id för avdrag på slutfakturan. */
async function acconto(ctx: Ctx, matterId: string, bips: number, amountOre: number, daysAgo: number): Promise<string> {
  const { run, invoice } = await ctx.c.billingRun.createAcconto({
    id: demoAccontoInvoiceId(matterId), matterId, recipient: "KLIENT",
    clientShareBips: bips, amountOre,
    invoiceDate: isoDaysAgo(daysAgo + 20), dueDate: isoDaysAgo(daysAgo - 10),
    notes: "Aconto — klientens andel (självrisk/rättshjälpsavgift)",
  });
  ctx.res.invoices++;
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  return run.id;
}

/** Slutfaktura via billing-run → SENT. Returnerar {id, amount}. */
async function finalSent(ctx: Ctx, matterId: string, recipient: BillingRunRecipient, deducted: string[], daysAgo: number): Promise<FinalInv> {
  const { invoice } = await ctx.c.billingRun.createFinal({
    id: demoFinalInvoiceId(matterId), matterId, recipient, deductedBillingRunIds: deducted,
    invoiceDate: isoDaysAgo(daysAgo), dueDate: isoDaysAgo(daysAgo - 30),
  });
  ctx.res.invoices++;
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
  return { id: invoice.id, amount: invoice.amount, matterId };
}

/** Slutfaktura som LÄMNAS draft (ej skickad). */
async function finalDraft(ctx: Ctx, matterId: string, recipient: BillingRunRecipient, daysAgo: number): Promise<void> {
  await ctx.c.billingRun.createFinal({
    id: demoFinalInvoiceId(matterId), matterId, recipient, deductedBillingRunIds: [],
    invoiceDate: isoDaysAgo(daysAgo),
  });
  ctx.res.invoices++;
}

async function addReminders(ctx: Ctx, planId: string, months: number): Promise<void> {
  for (let m = months; m >= 1; m--) {
    const due = new Date();
    due.setMonth(due.getMonth() - m);
    const dueMonth = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}`;
    await ctx.c.paymentPlan.recordReminder({ planId, dueMonth, type: "DUE", sentAt: new Date(due.getFullYear(), due.getMonth(), 10).toISOString() });
    ctx.res.reminders++;
  }
}

// ─── Livscykel-scenarier (på en redan skapad+skickad slutfaktura) ──────────

async function lcPaid(ctx: Ctx, inv: FinalInv, daysAgo: number): Promise<void> {
  if (inv.amount <= 0) return;
  await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: inv.amount, paidAt: isoDaysAgo(daysAgo - 20), note: "Full betalning" });
  ctx.res.payments++;
}

async function lcActivePlan(ctx: Ctx, inv: FinalInv, daysAgo: number, monthsPaid: number): Promise<void> {
  if (inv.amount < 5) return;
  const monthly = Math.ceil(inv.amount / 5);
  const plan = await ctx.c.invoice.createPaymentPlan({ id: demoPaymentPlanId(inv.matterId), invoiceId: inv.id, monthlyAmount: monthly, dayOfMonth: 15, startDate: isoDaysAgo(daysAgo - 5) });
  ctx.res.paymentPlans++;
  await addReminders(ctx, plan.id, Math.min(2, monthsPaid + 1));
  for (let m = 0; m < monthsPaid; m++) {
    await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: monthly, paidAt: isoDaysAgo(daysAgo - 30 - m * 30), note: `Avbetalning ${m + 1}` });
    ctx.res.payments++;
  }
}

async function lcCompletedPlan(ctx: Ctx, inv: FinalInv, daysAgo: number): Promise<void> {
  if (inv.amount <= 0) return;
  const plan = await ctx.c.invoice.createPaymentPlan({ id: demoPaymentPlanId(inv.matterId), invoiceId: inv.id, monthlyAmount: Math.ceil(inv.amount / 3), dayOfMonth: 1, startDate: isoDaysAgo(daysAgo - 5) });
  ctx.res.paymentPlans++;
  await addReminders(ctx, plan.id, 6);
  await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: inv.amount, paidAt: isoDaysAgo(daysAgo - 10), note: "Slutbetalning" });
  ctx.res.payments++;
}

async function lcCancelledPlan(ctx: Ctx, inv: FinalInv, daysAgo: number): Promise<void> {
  if (inv.amount <= 0) return;
  const plan = await ctx.c.invoice.createPaymentPlan({ id: demoPaymentPlanId(inv.matterId), invoiceId: inv.id, monthlyAmount: Math.ceil(inv.amount / 6), dayOfMonth: 28, startDate: isoDaysAgo(daysAgo - 5), notes: "Avbruten på klientens begäran" });
  ctx.res.paymentPlans++;
  await ctx.c.invoice.cancelPaymentPlan({ planId: plan.id });
}

async function lcCredit(ctx: Ctx, inv: FinalInv, _daysAgo: number): Promise<void> {
  await ctx.c.invoice.createCredit({ id: demoCreditInvoiceId(inv.matterId), invoiceId: inv.id, notes: "Kreditering — felaktig fakturering" });
  ctx.res.invoices++;
  ctx.res.credits++;
}

async function lcWriteOff(ctx: Ctx, inv: FinalInv, daysAgo: number): Promise<void> {
  const part = Math.floor(inv.amount / 4);
  if (part > 0) {
    await ctx.c.invoice.recordPayment({ invoiceId: inv.id, amount: part, paidAt: isoDaysAgo(daysAgo - 15), note: "Delbetalning" });
    ctx.res.payments++;
  }
  await ctx.c.invoice.writeOff({ invoiceId: inv.id, reason: "Klient försatt i konkurs", writtenOffAt: isoDaysAgo(daysAgo - 30) });
  ctx.res.writeOffs++;
}

/** PRIVAT-ärendets livscykel roteras så ~9 ärenden täcker alla tillstånd. */
const PRIVATE_LIFECYCLES = [
  (c: Ctx, inv: FinalInv, d: number) => lcPaid(c, inv, d),
  (c: Ctx, inv: FinalInv, d: number) => lcActivePlan(c, inv, d, 2),
  (c: Ctx, inv: FinalInv, d: number) => lcCompletedPlan(c, inv, d),
  (c: Ctx, inv: FinalInv, d: number) => lcCancelledPlan(c, inv, d),
  (c: Ctx, inv: FinalInv, d: number) => lcCredit(c, inv, d),
  (c: Ctx, inv: FinalInv, d: number) => lcWriteOff(c, inv, d),
  (c: Ctx, inv: FinalInv, d: number) => lcActivePlan(c, inv, d, 4),
];

async function runKostnadsrakning(ctx: Ctx, matterId: string, withVerdict: boolean): Promise<void> {
  const kr = await ctx.c.billingRun.createKostnadsrakning({ matterId, notes: "Kostnadsräkning för offentligt försvarsuppdrag" });
  if (withVerdict) {
    // Domstolens beslut registreras på KR:n (prutning −500 kr) → BESLUTAD,
    // sedan skapas fakturan (prutningen läses ur beslutet, inte som input).
    await ctx.c.billingRun.recordKostnadsrakningBeslut({
      billingRunId: kr.run.id, awardedOre: Math.max(0, kr.run.workValueOreAtRun - 50_000), prutningOre: -50_000,
    });
    await ctx.c.billingRun.setVerdict({ billingRunId: kr.run.id });
    ctx.res.invoices++;
    ctx.res.kostnadsrakningSent++;
  } else {
    ctx.res.kostnadsrakningPending++;
  }
}

/**
 * Rättshjälp följer KR-livscykeln (#828): aconto → kostnadsräkning till domstol
 * (fryser arbetet) → registrera domstolens beslut → faktura/överklagan i UI:t.
 * Demon lämnar ärendena i olika lägen (`INSKICKAD` = väntar på beslut, `BESLUTAD`
 * = beslut registrerat, redo att faktureras/överklagas) så hela KR-kortet kan
 * testas — fakturasteget görs av användaren.
 */
async function runRattshjalpBilling(ctx: Ctx, matterId: string, daysAgo: number, stage: "INSKICKAD" | "BESLUTAD"): Promise<void> {
  // Rådgivningstimmen (ärendets FÖRSTA händelse) är en riktig STANDARD-klient-
  // faktura som skapas SKICKAD (#853) — separat från KR:n.
  await ctx.c.invoice.createRadgivning({ matterId });
  ctx.res.invoices++;
  await acconto(ctx, matterId, 3000, 150_000, daysAgo);
  const kr = await ctx.c.billingRun.createKostnadsrakning({ matterId, notes: "Kostnadsräkning till domstol (rättshjälp)" });
  ctx.res.kostnadsrakningPending++;
  if (stage === "INSKICKAD") return; // väntar på domstolens beslut
  // Domstolens beslut (dömt belopp = hela det yrkade i demon, ingen prutning).
  await ctx.c.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: kr.run.workValueOreAtRun });
}

/** Aconto med ORGANISKT id (#878) — så flera aconton kan ställas ut på SAMMA ärende
 *  (den delade `acconto`-helpern har ett enda deterministiskt id per ärende). */
async function accontoVarying(ctx: Ctx, matterId: string, bips: number, amountOre: number, daysAgo: number): Promise<void> {
  const { invoice } = await ctx.c.billingRun.createAcconto({
    matterId, recipient: "KLIENT", clientShareBips: bips, amountOre,
    invoiceDate: isoDaysAgo(daysAgo + 20), dueDate: isoDaysAgo(daysAgo - 10),
    notes: `Aconto — rättshjälpsavgift ${bips / 100} % (löpande sats)`,
  });
  ctx.res.invoices++;
  await ctx.c.invoice.setStatus({ invoiceId: invoice.id, status: "SENT" });
}

/**
 * Rättshjälp med TIDSVARIERANDE avgift → kreditfaktura (#878). Hela förfarandet:
 * rådgivning → 3 aconton vid löpande satser (5 % / 75 % / 5 %) → kostnadsräkning till
 * domstol → myndighetens SLUTLIGA helhetsbeslut (5 %) via settlement → klienten har
 * överfakturerats (särskilt 75 %-acontot) → `settleCoverage` skapar en KREDITfaktura.
 */
async function runRattshjalpVaryingRate(ctx: Ctx, matterId: string): Promise<void> {
  await ctx.c.invoice.createRadgivning({ matterId });
  ctx.res.invoices++;
  await accontoVarying(ctx, matterId, 500, 30_000, 105);   // period 1: arbetslös, 5 %
  await accontoVarying(ctx, matterId, 7500, 600_000, 55);  // period 2: anställd, 75 % (överfakturerar)
  await accontoVarying(ctx, matterId, 500, 30_000, 20);    // period 3: åter arbetslös, 5 %
  const kr = await ctx.c.billingRun.createKostnadsrakning({ matterId, notes: "Kostnadsräkning till domstol (rättshjälp, varierande avgift)" });
  ctx.res.kostnadsrakningPending++;
  // Myndighetens slutliga helhetsbeslut = 5 % (matterns clientShareBips); domstolen
  // fastställer totalbeloppet (hela det yrkade i demon, ingen prutning).
  await ctx.c.billingRun.recordKostnadsrakningBeslut({ billingRunId: kr.run.id, awardedOre: kr.run.workValueOreAtRun });
  const res = await ctx.c.billingRun.settleCoverage({ matterId, payerRecipient: "DOMSTOL" });
  ctx.res.invoices += res.creditInvoice ? 3 : 2; // klient-final + domstols-final (+ ev. kredit)
  if (res.creditInvoice) ctx.res.credits++;
}

async function runClientBilling(ctx: Ctx, matterId: string, pm: string, clientIdx: number): Promise<void> {
  const daysAgo = 30 + clientIdx * 6;
  const deducted = pm === "RATTSSKYDD"
    ? [await acconto(ctx, matterId, 2000, 200_000, daysAgo)]
    : [];
  const recipient = BILLING_RUN_RECIPIENT[pm] ?? "KLIENT";
  // Försäkring/myndighet betalar i sin helhet; privatklienter får varierad livscykel.
  if (recipient !== "KLIENT") {
    const inv = await finalSent(ctx, matterId, recipient, deducted, daysAgo);
    await lcPaid(ctx, inv, daysAgo);
    return;
  }
  // Var sjunde privat-ärende lämnas som draft (visar "ej skickad").
  if (clientIdx % 7 === 6) {
    await finalDraft(ctx, matterId, recipient, 20);
    return;
  }
  const inv = await finalSent(ctx, matterId, recipient, deducted, daysAgo);
  await PRIVATE_LIFECYCLES[clientIdx % PRIVATE_LIFECYCLES.length]!(ctx, inv, daysAgo);
}

export async function populateBilling(caller: GeneratorCaller, seed: SeedDataset): Promise<BillingResult> {
  const ctx: Ctx = {
    c: caller as AnyCaller,
    res: { invoices: 0, payments: 0, paymentPlans: 0, credits: 0, reminders: 0, writeOffs: 0, kostnadsrakningPending: 0, kostnadsrakningSent: 0 },
  };
  const active = arr(seed, "matters").filter((m) => m.status === "ACTIVE");

  let clientIdx = 0;
  let krIdx = 0;
  let rhIdx = 0;
  for (const m of active) {
    const pm = String(m.paymentMethod);
    const matterId = String(m.id);
    if (pm === "OFFENTLIGT_UPPDRAG") {
      if (m.isTaxeArende === true) continue; // taxe-ärenden: egen brottmålstaxa-väg
      await runKostnadsrakning(ctx, matterId, krIdx % 2 === 0); // kostnadsräkning byggs på arbetet (0 ok)
      krIdx++;
      continue;
    }
    if (!hasWork(seed, matterId)) continue; // klientfaktura kräver fakturerbart arbete
    if (matterId === "m-020-rattshjalp-varierande") {
      // Dedikerat flöde (#878): varierande avgift → settlement → kreditfaktura.
      await runRattshjalpVaryingRate(ctx, matterId);
      continue;
    }
    if (pm === "RATTSHJALP") {
      // Visa KR-kortets båda actionabla lägen: första ärendet väntar på beslut,
      // nästa har beslut registrerat (redo att faktureras/överklagas).
      await runRattshjalpBilling(ctx, matterId, 30 + rhIdx * 6, rhIdx % 2 === 0 ? "INSKICKAD" : "BESLUTAD");
      rhIdx++;
      continue;
    }
    await runClientBilling(ctx, matterId, pm, clientIdx);
    clientIdx++;
  }
  return ctx.res;
}
