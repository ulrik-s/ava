#!/usr/bin/env bun
/**
 * Server-first FAKTURERINGS-E2E — kör mot en KÖRANDE server-first-container
 * (docker-compose.server-first.yml), dvs. riktig Postgres över riktig HTTP.
 *
 * Enhetstesterna täcker matematiken och tillståndsmaskinen var för sig. Det här
 * bevisar KEDJAN mot den deployade artefakten, i tre delar:
 *
 *   1. FAKTURERING — tid + utlägg → slutfaktura. Arbetet fryses (kan inte
 *      faktureras igen), momsen är exakt 25 % av arvodet (#782), och fakturan
 *      får nummer + OCR (ADR 0012).
 *   2. AVBETALNING ENLIGT PLAN — plan på en SENT-faktura → INSTALLMENT_PLAN,
 *      månadsbetalningar minskar utestående exakt, och SISTA betalningen
 *      stänger både fakturan (PAID) och planen (COMPLETED).
 *   3. AVBETALNING SOM INTE KOMMER I TID — `scanDueReminders` med `asOf` ger
 *      DUE när förfallodagen passerat, OVERDUE nästa månad när inget betalats,
 *      och är IDEMPOTENT (samma scan igen ger inga nya påminnelser).
 *
 * Determinism: hela försenings-delen styrs av `asOf` i st.f. väggklockan, så
 * testet beter sig likadant den 1:a och den 31:a. Utan den parametern hade
 * del 3 varit ett test som passerar eller fallerar beroende på dagens datum.
 *
 *   bun run server-first:build
 *   docker compose -f tooling/docker/docker-compose.server-first.yml up -d --build --wait
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test bun run db:migrate
 *   SERVER_URL=http://localhost:3001 \
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/billing-pipeline-e2e.ts
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import postgres from "postgres";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";
const USER = "anna-billing@byra.se";

/** Timtaxa och tid valda så arvodet blir jämnt: 2 h × 2 500 kr = 5 000 kr. */
const HOURLY_RATE_ORE = 250_000;
const WORK_MINUTES = 120;
const ARVODE_NET_ORE = Math.round((WORK_MINUTES / 60) * HOURLY_RATE_ORE);
const ARVODE_VAT_ORE = Math.round(ARVODE_NET_ORE * 0.25);

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(`assert: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function kr(ore: number): string { return `${(ore / 100).toLocaleString("sv-SE")} kr`; }

/** Seeda en allowlistad användare (orgProcedure släpper bara igenom dessa). */
async function seedUser(email: string, name: string): Promise<string> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    const existing = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (existing[0]) return existing[0].id;
    const id = uuidv7();
    await sql`INSERT INTO users (id, organization_id, email, name, role, active)
              VALUES (${id}, ${ORG}, ${email}, ${name}, 'LAWYER', true)`;
    return id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function clientFor(email: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${SERVER_URL}/api/trpc`,
      transformer: superjson,
      headers: () => ({ "X-Auth-Request-Email": email }),
    })],
  });
}

async function waitForServer(client: TRPCClient<AppRouter>): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await client.documentTemplate.list.query(); return; } catch { await sleep(1000); }
  }
  throw new Error(`server-first svarade inte på ${SERVER_URL} inom 30s`);
}

/** Ett ärende med klient — grunden för allt nedan. */
async function setupMatter(c: TRPCClient<AppRouter>, userId: string, label: string): Promise<string> {
  const client = await c.contacts.create.mutate({
    name: `Klient ${label}`, contactType: "PERSON", email: `klient-${label}@example.test`,
  });
  const matter = await c.matter.create.mutate({
    matterNumber: `E2E-${label}`, title: `Fakturerings-E2E ${label}`,
    matterType: "Tvistemål", paymentMethod: "PRIVAT", responsibleLawyerId: userId,
  });
  await c.matter.addContact.mutate({ matterId: matter.id, contactId: client.id, role: "KLIENT" });
  return matter.id;
}

/** Registrera debiterbart arbete på ärendet. */
async function logWork(c: TRPCClient<AppRouter>, matterId: string, userId: string): Promise<void> {
  await c.timeEntry.create.mutate({
    matterId, userId, date: new Date().toISOString().slice(0, 10),
    minutes: WORK_MINUTES, description: "Genomgång och skrivelse",
    billable: true, hourlyRate: HOURLY_RATE_ORE,
  });
}

// ─── Del 1: fakturering ────────────────────────────────────────────────────

async function phaseInvoicing(c: TRPCClient<AppRouter>, matterId: string, userId: string): Promise<string> {
  console.log("\n=== Del 1: fakturering ===");
  await logWork(c, matterId, userId);

  const proposal = await c.billingRun.proposal.query({ matterId });
  assert(proposal.workValueOre === ARVODE_NET_ORE,
    `upparbetat ${kr(proposal.workValueOre)} ≠ förväntat ${kr(ARVODE_NET_ORE)}`);
  console.log(`  ✓ Upparbetat ofakturerat: ${kr(proposal.workValueOre)}`);

  const { invoice } = await c.billingRun.createFinal.mutate({ matterId, recipient: "KLIENT" });
  const expected = ARVODE_NET_ORE + ARVODE_VAT_ORE;
  assert(invoice.amount === expected, `fakturabelopp ${kr(invoice.amount)} ≠ ${kr(expected)}`);
  assert(invoice.vatOre === ARVODE_VAT_ORE, `moms ${kr(invoice.vatOre ?? 0)} ≠ ${kr(ARVODE_VAT_ORE)} (25 %, #782)`);
  assert(/^F-\d{4}-\d+$/.test(String(invoice.invoiceNumber)), `fakturanummer saknar F-format: ${invoice.invoiceNumber}`);
  assert(Boolean(invoice.ocrReference), "klientfaktura ska ha OCR (ADR 0012)");
  console.log(`  ✓ Slutfaktura ${invoice.invoiceNumber}: ${kr(invoice.amount)} (moms ${kr(invoice.vatOre ?? 0)}), OCR satt`);

  // Arbetet ska vara FRYST — annars kan samma timmar faktureras två gånger.
  const after = await c.billingRun.proposal.query({ matterId });
  assert(after.workValueOre === 0, `arbetet frystes inte: ${kr(after.workValueOre)} kvar som ofakturerat`);
  console.log("  ✓ Arbetet fryst — kan inte faktureras igen");

  // Överbetalning ska avvisas (partitionsvakten, ADR 0007).
  await c.invoice.setStatus.mutate({ invoiceId: invoice.id, status: "SENT" });
  let rejected = false;
  try {
    await c.invoice.recordPayment.mutate({
      invoiceId: invoice.id, amount: invoice.amount + 100,
      paidAt: new Date().toISOString(), note: "Överbetalning (ska avvisas)",
    });
  } catch { rejected = true; }
  assert(rejected, "en betalning större än fakturan accepterades — partitionsvakten läcker");
  console.log("  ✓ Överbetalning avvisas (ADR 0007)");

  return invoice.id;
}

// ─── Del 2: avbetalning enligt plan ────────────────────────────────────────

async function phaseInstallmentsOnTime(c: TRPCClient<AppRouter>, invoiceId: string): Promise<void> {
  console.log("\n=== Del 2: avbetalning enligt plan ===");
  const total = ARVODE_NET_ORE + ARVODE_VAT_ORE;
  const installments = 3;
  const monthly = Math.ceil(total / installments);

  const plan = await c.invoice.createPaymentPlan.mutate({
    invoiceId, monthlyAmount: monthly, dayOfMonth: 15,
    startDate: new Date().toISOString().slice(0, 10), notes: "E2E-plan",
  });
  const withPlan = await c.invoice.getById.query({ id: invoiceId });
  assert(withPlan.status === "INSTALLMENT_PLAN", `status ${withPlan.status} ≠ INSTALLMENT_PLAN`);
  console.log(`  ✓ Plan skapad: ${installments} × ${kr(monthly)}, faktura → INSTALLMENT_PLAN`);

  let paid = 0;
  for (let n = 1; n <= installments; n++) {
    // Sista posten kapas till ÅTERSTODEN — annars översumerar den fakturan.
    const amount = Math.min(monthly, total - paid);
    const res = await c.invoice.recordPayment.mutate({
      invoiceId, amount, paidAt: new Date().toISOString(), note: `Månadsbetalning ${n}`,
    });
    paid += amount;
    assert(res.paidSum === paid, `paidSum ${kr(res.paidSum)} ≠ ${kr(paid)}`);
    const last = n === installments;
    assert(res.settled === last, `settled=${res.settled} vid betalning ${n} av ${installments}`);
    console.log(`  ✓ Betalning ${n}: ${kr(amount)} → betalt ${kr(paid)} av ${kr(total)}${last ? " (slutreglerad)" : ""}`);
  }

  const done = await c.invoice.getById.query({ id: invoiceId });
  assert(done.status === "PAID", `faktura ${done.status} ≠ PAID efter full betalning`);
  const plans = await c.paymentPlan.list.query({});
  const updated = plans.items.find((p) => p.id === plan.id);
  assert(updated?.status === "COMPLETED", `plan ${updated?.status} ≠ COMPLETED`);
  console.log("  ✓ Sista betalningen stängde både fakturan (PAID) och planen (COMPLETED)");
}

// ─── Del 3: avbetalning som inte kommer i tid ──────────────────────────────

/** `YYYY-MM` för ett datum — påminnelsernas nyckel. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function phaseLateInstallments(c: TRPCClient<AppRouter>, matterId: string, userId: string): Promise<void> {
  console.log("\n=== Del 3: avbetalning som inte kommer i tid ===");
  await logWork(c, matterId, userId);
  const { invoice } = await c.billingRun.createFinal.mutate({ matterId, recipient: "KLIENT" });
  await c.invoice.setStatus.mutate({ invoiceId: invoice.id, status: "SENT" });

  // Planen startar i en KÄND månad så scan-datumen blir deterministiska.
  const start = new Date(Date.UTC(2026, 0, 10)); // 2026-01-10
  const dayOfMonth = 15;
  const plan = await c.invoice.createPaymentPlan.mutate({
    invoiceId: invoice.id, monthlyAmount: Math.ceil(invoice.amount / 4), dayOfMonth,
    startDate: start.toISOString().slice(0, 10), notes: "E2E-plan (försenad)",
  });

  // Förfallodagen i startmånaden har passerat → DUE, ingen OVERDUE ännu.
  const afterFirstDue = new Date(Date.UTC(2026, 0, 20)).toISOString();
  const first = await c.paymentPlan.scanDueReminders.mutate({ asOf: afterFirstDue });
  assert(first.due >= 1, `ingen DUE-påminnelse vid ${afterFirstDue} (due=${first.due})`);
  assert(first.overdue === 0, `OVERDUE för tidigt (overdue=${first.overdue})`);
  console.log(`  ✓ Förfallodagen passerad → DUE (${first.due} st), ingen OVERDUE`);

  // IDEMPOTENS: samma scan igen ska inte skapa något nytt.
  const again = await c.paymentPlan.scanDueReminders.mutate({ asOf: afterFirstDue });
  assert(again.planned === 0, `scan är inte idempotent — ${again.planned} nya påminnelser vid omkörning`);
  console.log("  ✓ Omkörd scan skapar inga dubbletter (idempotent)");

  // Nästa månad, fortfarande obetalt → OVERDUE för föregående månad.
  const nextMonth = new Date(Date.UTC(2026, 1, 20)).toISOString();
  const late = await c.paymentPlan.scanDueReminders.mutate({ asOf: nextMonth });
  assert(late.overdue >= 1, `ingen OVERDUE trots obetald föregående månad (overdue=${late.overdue})`);
  console.log(`  ✓ Obetald månad → OVERDUE (${late.overdue} st) — eskalering före vänlig DUE`);

  // Påminnelseloggen ska bära bägge, nycklade per månad.
  const detail = await c.paymentPlan.getById.query({ id: plan.id });
  const kinds = new Set((detail.reminders ?? []).map((r) => `${r.type}:${r.dueMonth}`));
  assert(kinds.has(`DUE:${monthKey(start)}`), `DUE för ${monthKey(start)} saknas i loggen: ${[...kinds].join(", ")}`);
  assert([...kinds].some((k) => k.startsWith("OVERDUE:")), `ingen OVERDUE i loggen: ${[...kinds].join(", ")}`);
  console.log(`  ✓ Påminnelseloggen: ${[...kinds].sort().join(", ")}`);

  // En betalning stoppar eskaleringen: remaining ≤ 0 → inga fler påminnelser.
  await c.invoice.recordPayment.mutate({
    invoiceId: invoice.id, amount: invoice.amount,
    paidAt: nextMonth, note: "Full betalning (stoppar eskalering)",
  });
  const settled = await c.paymentPlan.scanDueReminders.mutate({ asOf: new Date(Date.UTC(2026, 2, 20)).toISOString() });
  assert(settled.planned === 0, `påminnelser skickades för en betald plan (planned=${settled.planned})`);
  console.log("  ✓ Fullbetald plan påminns inte längre");
}

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Billing");
  const c = clientFor(USER);
  await waitForServer(c);
  console.log(`Fakturerings-E2E mot ${SERVER_URL}`);

  const stamp = Date.now().toString(36);
  const invoiceMatter = await setupMatter(c, userId, `fakt-${stamp}`);
  const invoiceId = await phaseInvoicing(c, invoiceMatter, userId);
  await phaseInstallmentsOnTime(c, invoiceId);

  const lateMatter = await setupMatter(c, userId, `sen-${stamp}`);
  await phaseLateInstallments(c, lateMatter, userId);

  console.log("\n✓ Fakturerings-E2E klart: fakturering, avbetalning enligt plan, försenad avbetalning.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Fakturerings-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
