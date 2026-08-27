#!/usr/bin/env bun
/**
 * Server-first SCENARIO-E2E — hela byråns faktureringsverklighet mot riktig
 * Postgres över riktig HTTP (docker-compose.server-first.yml).
 *
 * `billing-pipeline-e2e.ts` bevisar det enkla fallet: en privatklient, en
 * faktura, en plan som betalas i tid. Det här bevisar det som faktiskt är
 * svårt — TVÅ BETALANDE och EN KLIENT SOM INTE BETALAR SOM ÖVERENSKOMMET:
 *
 *   1. Brottmål + RÄTTSHJÄLP via kostnadsräkning → domstol + klient delar
 *      notan. Klientens del är rättshjälpsavgiften (`clientShareBips`).
 *   2. Familjemål + RÄTTSSKYDD → försäkringsbolag + klient. Klientens del är
 *      självrisken.
 *   3. Familjemål + RÄTTSHJÄLP utan KR (slutreglering direkt).
 *   4. Klientens självrisk betalas via AVBETALNINGSPLAN där posterna sätts ned
 *      till halva beloppet och ibland uteblir helt.
 *
 * Invarianten som binder ihop 1–3: klientfakturan + betalarfakturan ska
 * TILLSAMMANS motsvara hela anspråket. Går de isär har någon betalat för lite
 * eller för mycket — och i ett täckningsärende är det byrån som bär glappet.
 *
 * Del 4 är den som fångar verkligheten: en avbetalningsplan är ett löfte, inte
 * en garanti. Halvbetalningar och uteblivna månader ska minska skulden exakt
 * så mycket som betalats, eskalera till OVERDUE när en månad missas, och
 * fortfarande stänga planen när sista kronan kommer in.
 *
 *   bun run e2e:billing-scenarios     # startar docker, migrerar, kör, river
 */

import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

const USER = "anna-scenarios@byra.se";
const RATE_ORE = 250_000;      // byråns timtaxa (irrelevant i täckningsärenden)
const WORK_MINUTES = 600;      // 10 h
/** Domstolsverkets timkostnadsnorm 2026 — täckningsärenden ersätts på den. */
const NORM_ORE = 162_600;
const VAT = 1.25;

export interface Scenario {
  key: string;
  title: string;
  matterType: string;
  paymentMethod: "RATTSHJALP" | "RATTSSKYDD";
  /** Klientens andel i bips: rättshjälpsavgift resp. självrisk. */
  clientShareBips: number;
  payerRecipient: "DOMSTOL" | "FORSAKRING";
  /** Rättshjälp går via kostnadsräkning till domstol innan slutreglering. */
  viaKostnadsrakning: boolean;
  extra?: Record<string, unknown>;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    key: "brottmal-rattshjalp", title: "Brottmål — rättshjälp", matterType: "Brottmål",
    paymentMethod: "RATTSHJALP", clientShareBips: 4000, payerRecipient: "DOMSTOL",
    viaKostnadsrakning: true, extra: { rattshjalpMaxTimmar: 100 },
  },
  {
    key: "familjemal-rattsskydd", title: "Familjemål — rättsskydd", matterType: "Familjemål",
    paymentMethod: "RATTSSKYDD", clientShareBips: 2000, payerRecipient: "FORSAKRING",
    viaKostnadsrakning: false,
    extra: { rattsskyddMaxOre: 10_000_000, rattsskyddSjalvriskMinOre: 180_000 },
  },
  {
    key: "familjemal-rattshjalp", title: "Familjemål — rättshjälp", matterType: "Familjemål",
    paymentMethod: "RATTSHJALP", clientShareBips: 3000, payerRecipient: "DOMSTOL",
    viaKostnadsrakning: false, extra: { rattshjalpMaxTimmar: 100 },
  },
];

/** Ett nytt ärende med NY klient — varje scenario står för sig självt. */
export async function newMatterWithClient(c: Ava, userId: string, sc: Scenario, stamp: string): Promise<{ matterId: string; clientName: string }> {
  const clientName = `Klient ${sc.key} ${stamp}`;
  const client = await c.contacts.create.mutate({
    name: clientName, contactType: "PERSON", email: `${sc.key}-${stamp}@klient.test`,
  });
  const matter = await c.matter.create.mutate({
    matterNumber: `E2E-${sc.key}-${stamp}`, title: `${sc.title} ${stamp}`,
    matterType: sc.matterType, paymentMethod: sc.paymentMethod,
    clientShareBips: sc.clientShareBips, responsibleLawyerId: userId,
    ...(sc.extra ?? {}),
  });
  await c.matter.addContact.mutate({ matterId: matter.id, contactId: client.id, role: "KLIENT" });
  await c.timeEntry.create.mutate({
    matterId: matter.id, userId, date: "2026-03-02", minutes: WORK_MINUTES,
    description: "Handläggning", billable: true, hourlyRate: RATE_ORE,
  });
  return { matterId: matter.id, clientName };
}

/** Kostnadsräkning → domstolens beslut. Returnerar det yrkade bruttot. */
async function runKostnadsrakning(c: Ava, matterId: string): Promise<number> {
  const { run } = await c.billingRun.createKostnadsrakning.mutate({ matterId });
  const yrkat = run.workValueOreAtRun;
  await c.billingRun.recordKostnadsrakningBeslut.mutate({ billingRunId: run.id, awardedOre: yrkat });
  return yrkat;
}

/** Kör ett täckningsscenario → returnerar klientfakturans id (självrisken). */
export async function runCoverageScenario(c: Ava, userId: string, sc: Scenario, stamp: string): Promise<string> {
  console.log(`\n--- ${sc.title} (klientandel ${sc.clientShareBips / 100} %) ---`);
  const { matterId } = await newMatterWithClient(c, userId, sc, stamp);

  const yrkat = sc.viaKostnadsrakning ? await runKostnadsrakning(c, matterId) : null;
  if (yrkat !== null) console.log(`  Kostnadsräkning till domstol: ${kr(yrkat)}`);

  const split = await c.billingRun.coverageSplit.query({ matterId });
  const res = await c.billingRun.settleCoverage.mutate({ matterId, payerRecipient: sc.payerRecipient });
  const clientOre = res.clientInvoice.amount;
  const payerOre = res.payerInvoice.amount;

  // TVÅ BETALANDE: båda fakturorna finns och går till olika mottagare.
  assert(clientOre > 0, `klientfakturan är tom (${kr(clientOre)})`);
  assert(payerOre > 0, `betalarfakturan är tom (${kr(payerOre)})`);
  console.log(`  Klient: ${kr(clientOre)} · ${sc.payerRecipient}: ${kr(payerOre)}`);

  // Summan ska motsvara HELA anspråket inkl moms. Går de isär bär byrån glappet.
  const expectedTotal = Math.round(split.totalOre * VAT);
  const sum = clientOre + payerOre;
  assert(Math.abs(sum - expectedTotal) <= 2,
    `klient + betalare = ${kr(sum)} ≠ anspråket ${kr(expectedTotal)}`);
  console.log(`  ✓ Summan stämmer: ${kr(sum)} = hela anspråket inkl moms`);

  // Klientens andel ska vara exakt den avtalade — inte "ungefär".
  const clientShare = Math.round((clientOre / sum) * 10_000);
  assert(Math.abs(clientShare - sc.clientShareBips) <= 1,
    `klientandel ${clientShare} bips ≠ avtalade ${sc.clientShareBips}`);
  console.log(`  ✓ Klientandelen är ${clientShare / 100} % som avtalat`);

  // Rättshjälp: rådgivningstimmen ligger UTANFÖR (#868) → 9 h, inte 10.
  if (sc.paymentMethod === "RATTSHJALP") {
    const utanRadgivning = Math.round(((WORK_MINUTES - 60) / 60) * NORM_ORE * VAT);
    assert(Math.abs(sum - utanRadgivning) <= 2,
      `rådgivningstimmen carvades inte: ${kr(sum)} ≠ ${kr(utanRadgivning)}`);
    console.log("  ✓ Rådgivningstimmen ligger utanför anspråket (#868)");
  }
  return res.clientInvoice.id;
}

/** En post i avbetalningsplanen: vad som SKULLE betalas och vad som faktiskt kom in. */
interface Installment { label: string; factor: number }

/** Planen som verkligheten ser ut: full, halv, utebliven, halv, resten. */
const SCHEDULE: readonly Installment[] = [
  { label: "full", factor: 1 },
  { label: "halv", factor: 0.5 },
  { label: "utebliven", factor: 0 },
  { label: "halv", factor: 0.5 },
];

/** Utestående på fakturan just nu (belopp − betalt). */
async function outstandingOf(c: Ava, invoiceId: string): Promise<number> {
  const inv = await c.invoice.getById.query({ id: invoiceId });
  const paid = (inv.payments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  return inv.amount - paid;
}

async function phasePartialInstallments(c: Ava, invoiceId: string): Promise<void> {
  console.log("\n--- Avbetalningsplan med nedsatta och uteblivna poster ---");
  const inv = await c.invoice.getById.query({ id: invoiceId });
  const total = inv.amount;
  await c.invoice.setStatus.mutate({ invoiceId, status: "SENT" });

  const monthly = Math.ceil(total / 5);
  const plan = await c.invoice.createPaymentPlan.mutate({
    invoiceId, monthlyAmount: monthly, dayOfMonth: 15,
    startDate: "2026-04-01", notes: "Klientens självrisk, avbetalning",
  });
  console.log(`  Plan: ${kr(total)} i poster om ${kr(monthly)}`);

  let paid = 0;
  for (const [i, step] of SCHEDULE.entries()) {
    const amount = Math.round(monthly * step.factor);
    if (amount > 0) {
      await c.invoice.recordPayment.mutate({
        invoiceId, amount, paidAt: `2026-0${4 + i}-15T12:00:00.000Z`,
        note: `Avbetalning ${i + 1} (${step.label})`,
      });
      paid += amount;
    }
    const kvar = await outstandingOf(c, invoiceId);
    assert(kvar === total - paid, `utestående ${kr(kvar)} ≠ ${kr(total - paid)} efter post ${i + 1}`);
    console.log(`  ✓ Post ${i + 1} (${step.label}): betalt ${kr(amount)} → utestående ${kr(kvar)}`);
  }

  // En utebliven månad ska ha eskalerat planen — det är hela poängen med
  // påminnelserna. Scannen körs som-av en dag efter sista postens förfallodag.
  const scan = await c.paymentPlan.scanDueReminders.mutate({ asOf: "2026-08-20T09:00:00.000Z" });
  assert(scan.overdue >= 1, `ingen OVERDUE trots utebliven post (overdue=${scan.overdue})`);
  console.log(`  ✓ Den uteblivna posten eskalerade till OVERDUE (${scan.overdue} st)`);

  // Fakturan får INTE vara betald ännu — den som betalat halva har halva kvar.
  const mid = await c.invoice.getById.query({ id: invoiceId });
  assert(mid.status !== "PAID", `fakturan markerades PAID trots ${kr(total - paid)} kvar`);
  console.log(`  ✓ Fakturan är inte PAID — ${kr(total - paid)} återstår`);

  // Slutbetalningen städar upp: resten in, faktura PAID, plan COMPLETED.
  const rest = total - paid;
  const res = await c.invoice.recordPayment.mutate({
    invoiceId, amount: rest, paidAt: "2026-09-15T12:00:00.000Z", note: "Slutbetalning",
  });
  assert(res.settled, "slutbetalningen slutreglerade inte fakturan");
  const done = await c.invoice.getById.query({ id: invoiceId });
  assert(done.status === "PAID", `faktura ${done.status} ≠ PAID`);
  const plans = await c.paymentPlan.list.query({});
  assert(plans.items.find((p) => p.id === plan.id)?.status === "COMPLETED", "planen stängdes inte");
  console.log(`  ✓ Slutbetalning ${kr(rest)} → faktura PAID, plan COMPLETED`);
}

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Scenarios");
  const c = clientFor(USER);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log(`Scenario-E2E: ${SCENARIOS.length} täckningsärenden + avbetalningsplan`);

  const clientInvoices: string[] = [];
  for (const sc of SCENARIOS) {
    clientInvoices.push(await runCoverageScenario(c, userId, sc, stamp));
  }

  // Avbetalningsplanen läggs på RÄTTSSKYDDS-klientens självrisk — det är det
  // realistiska fallet: klienten ska betala sin del men kan inte allt på en gång.
  const sjalvriskInvoice = clientInvoices[1];
  if (sjalvriskInvoice === undefined) throw new Error("rättsskydds-scenariot gav ingen klientfaktura");
  await phasePartialInstallments(c, sjalvriskInvoice);

  console.log(`\n✓ Scenario-E2E klart: ${SCENARIOS.length} ärendetyper med två betalande + nedsatta avbetalningar.`);
}

// Importerbar: `fortnox-bookkeeping-e2e.ts` återanvänder scenarierna för att
// bokföra SAMMA fakturor mot Fortnox. Utan guarden hade en import startat en
// hel e2e-körning som bieffekt.
if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(`\n✗ Scenario-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
