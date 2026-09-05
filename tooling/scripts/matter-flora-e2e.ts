#!/usr/bin/env bun
/**
 * ÄRENDEFLORA-E2E — ett ärende per betalningssätt, mot riktig Postgres över
 * riktig HTTP (docker-compose.server-first.yml). Systerskript till
 * `billing-scenarios-e2e.ts`, som täcker TÄCKNINGSÄRENDENA på djupet
 * (rättshjälp/rättsskydd med två betalande). Det här täcker BREDDEN — flödena
 * som annars aldrig körs skarpt (#1048).
 *
 * `BILLING_FLOWS` ger varje betalningssätt sitt eget flöde. Scenario-e2e:t rör
 * två av fem. Här körs resten, var och en genom SITT flöde:
 *
 *   PRIVAT              aconto → slutfaktura (aconto avräknat) → avbetalningsplan
 *   MIX                 som PRIVAT, plus kreditfaktura
 *   OFFENTLIGT_UPPDRAG  kostnadsräkning → dom → återbetalningsfaktura till klient
 *   RATTSSKYDD          slutreglering + försäkringsbolagets nedsättning
 *   PENDING             ärendet arbetas innan betalningssättet är fastställt
 *
 * ## Avbetalningsplanerna
 *
 * En plan är ett löfte, inte en garanti, och de tre utfallen belastar koden
 * olika. Scenario-e2e:t kör bara det mellersta:
 *
 *   SKÖTS      posterna kommer i tid → faktura PAID, plan COMPLETED
 *   HALTAR     nedsatta/uteblivna poster men går i mål   (billing-scenarios)
 *   HAVERERAR  klienten slutar betala → OVERDUE → planen avbryts → kundförlust
 *
 * Den sista vägen (`cancelPaymentPlan` → `writeOff` → BAD_DEBT) körs inte
 * skarpt någon annanstans, och den är den som gör ont om den går sönder: en
 * felaktig avskrivning är en felaktig intäktsredovisning.
 *
 * ## Datum, inte väggklocka
 *
 * Alla förfallo- och betalningsdatum är explicita (`asOf`, `paidAt`), aldrig
 * `new Date()`. Annars beter sig testet olika den 1:a och den 28:e i månaden —
 * ett datumberoende flake som är dyrt att felsöka i CI.
 *
 *   bun run e2e:matter-flora     # startar docker, migrerar, kör, river
 */

import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

const USER = "anna-flora@byra.se";
const RATE_ORE = 250_000;   // 2 500 kr/tim
const VAT = 1.25;

// ─── Riggning ──────────────────────────────────────────────────────────────

interface MatterSpec {
  key: string;
  title: string;
  matterType: string;
  paymentMethod: "PENDING" | "PRIVAT" | "MIX" | "RATTSSKYDD" | "OFFENTLIGT_UPPDRAG";
  /** COMPANY → företagsklient (ingen avbetalningsplan i verkligheten). */
  contactType?: "PERSON" | "COMPANY";
  extra?: Record<string, unknown>;
}

interface Fixture { matterId: string; clientId: string; clientName: string }

/** Nytt ärende med ny klient. Varje arketyp står för sig självt — delad
 *  klient hade gjort jävskontrollen och kontaktvyerna beroende av körordning. */
async function newMatter(c: Ava, userId: string, spec: MatterSpec, stamp: string): Promise<Fixture> {
  const contactType = spec.contactType ?? "PERSON";
  const clientName = `${contactType === "COMPANY" ? "Bolag" : "Klient"} ${spec.key} ${stamp}`;
  const client = await c.contacts.create.mutate({
    name: clientName,
    contactType,
    email: `${spec.key}-${stamp}@klient.test`,
    ...(contactType === "COMPANY" ? { orgNumber: "556677-8899" } : { personalNumber: "19850101-1234" }),
  });
  const matter = await c.matter.create.mutate({
    matterNumber: `FLORA-${spec.key}-${stamp}`,
    title: `${spec.title} ${stamp}`,
    matterType: spec.matterType,
    paymentMethod: spec.paymentMethod,
    responsibleLawyerId: userId,
    ...(spec.extra ?? {}),
  });
  await c.matter.addContact.mutate({ matterId: matter.id, contactId: client.id, role: "KLIENT" });
  return { matterId: matter.id, clientId: client.id, clientName };
}

/** Nedlagd tid. Beloppen är avsiktligt udda så en felsummering syns. */
async function logWork(c: Ava, matterId: string, userId: string, minutes: number): Promise<void> {
  await c.timeEntry.create.mutate({
    matterId, userId, date: "2026-03-02", minutes,
    description: "Handläggning", billable: true, hourlyRate: RATE_ORE,
  });
}

/**
 * Utlägg med OLIKA momssatser. Poängen är inte beloppen utan att
 * moms-trappan (#975) faktiskt körs: byrån betalar 0/6/12/25 %, och utlägget
 * debiteras vidare med 25 % — utom äkta utlägg (`passThrough`), som går utan
 * moms eftersom fakturan är ställd till klienten.
 */
async function logExpenses(c: Ava, matterId: string): Promise<void> {
  const rows = [
    { description: "Ansökningsavgift (äkta utlägg)", amount: 90_000, vatRate: 0, passThrough: true },
    { description: "Tågresa", amount: 45_000, vatRate: 600, passThrough: false },
    { description: "Hotell", amount: 120_000, vatRate: 1200, passThrough: false },
    { description: "Kopiering", amount: 25_000, vatRate: 2500, passThrough: false },
  ];
  for (const r of rows) {
    await c.expense.create.mutate({ matterId, date: "2026-03-03", billable: true, vatIncluded: false, ...r });
  }
}

/** Utestående på fakturan (belopp − inbetalt). */
async function outstanding(c: Ava, invoiceId: string): Promise<number> {
  const inv = await c.invoice.getById.query({ id: invoiceId });
  const paid = (inv.payments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0);
  return inv.amount - paid;
}

async function statusOf(c: Ava, invoiceId: string): Promise<string> {
  return (await c.invoice.getById.query({ id: invoiceId })).status;
}

async function planStatus(c: Ava, planId: string): Promise<string | undefined> {
  const plans = await c.paymentPlan.list.query({});
  return plans.items.find((p) => p.id === planId)?.status;
}

// ─── Arketyp 1: PRIVAT, plan som SKÖTS ─────────────────────────────────────

/**
 * Det vanliga, välfungerande fallet — och det enda som bevisar att en plan
 * KAN stängas normalt. Ärendet börjar PENDING (betalningssättet inte
 * fastställt vid upplägg) och beslutas till PRIVAT, vilket är hur ett ärende
 * faktiskt föds hos byrån.
 */
async function archetypePrivatDisciplined(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- PRIVAT — privatperson som sköter avbetalningsplanen ---");
  const { matterId } = await newMatter(c, userId, {
    key: "privat-ok", title: "Bodelning", matterType: "Familjemål", paymentMethod: "PENDING",
  }, stamp);

  // Arbetet börjar innan betalningssättet är fastställt — det är därför
  // PENDING finns. Beslutet kommer sedan och låser upp faktureringen.
  await logWork(c, matterId, userId, 600);
  await c.matter.update.mutate({ id: matterId, paymentMethod: "PRIVAT" });
  const decided = await c.matter.getById.query({ id: matterId });
  assert(decided.paymentMethod === "PRIVAT", `betalningssättet blev ${decided.paymentMethod}`);
  console.log("  ✓ PENDING → PRIVAT: arbete före beslut, fakturering efter");

  await logExpenses(c, matterId);

  // Aconto först, sedan slutfaktura där acontot AVRÄKNAS. Går avräkningen fel
  // dubbeldebiteras klienten — det är hela poängen med att köra båda stegen.
  const acc = await c.billingRun.createAcconto.mutate({
    matterId, recipient: "KLIENT", clientShareBips: 10_000,
    amountOre: 500_000, invoiceDate: "2026-04-01", notes: "Aconto 1",
  });
  const final = await c.billingRun.createFinal.mutate({
    matterId, recipient: "KLIENT", deductedBillingRunIds: [acc.run.id], invoiceDate: "2026-06-01",
  });
  const finalInvoice = final.invoice;
  assert(finalInvoice.amount > 0, `slutfakturan är tom (${kr(finalInvoice.amount)})`);
  console.log(`  Aconto ${kr(acc.invoice.amount)} · slutfaktura ${kr(finalInvoice.amount)} (aconto avräknat)`);

  await c.invoice.setStatus.mutate({ invoiceId: finalInvoice.id, status: "SENT" });

  // Planen sköts: fyra poster i tid, sista täcker resten exakt.
  const total = finalInvoice.amount;
  const monthly = Math.ceil(total / 4);
  const plan = await c.invoice.createPaymentPlan.mutate({
    invoiceId: finalInvoice.id, monthlyAmount: monthly, dayOfMonth: 15,
    startDate: "2026-07-01", notes: "Avbetalning, sköts",
  });

  let paid = 0;
  for (let i = 0; i < 4; i++) {
    const amount = Math.min(monthly, total - paid);
    if (amount <= 0) break;
    await c.invoice.recordPayment.mutate({
      invoiceId: finalInvoice.id, amount,
      paidAt: `2026-${String(7 + i).padStart(2, "0")}-15T12:00:00.000Z`, note: `Avbetalning ${i + 1}`,
    });
    paid += amount;
    const kvar = await outstanding(c, finalInvoice.id);
    assert(kvar === total - paid, `utestående ${kr(kvar)} ≠ ${kr(total - paid)} efter post ${i + 1}`);
  }
  assert(paid === total, `planen betalade ${kr(paid)} av ${kr(total)}`);

  const st = await statusOf(c, finalInvoice.id);
  assert(st === "PAID", `faktura ${st} ≠ PAID trots fullbetald plan`);
  assert(await planStatus(c, plan.id) === "COMPLETED", "planen stängdes inte trots full betalning");
  console.log(`  ✓ Planen sköttes: ${kr(total)} i 4 poster → faktura PAID, plan COMPLETED`);
}

// ─── Arketyp 2: PRIVAT, plan som HAVERERAR ─────────────────────────────────

/**
 * Klienten slutar betala. Det här är vägen ingen annan e2e kör, och den som
 * gör mest skada om den går sönder: planen ska eskalera till OVERDUE, gå att
 * avbryta, och fakturan ska kunna skrivas av som kundförlust (ADR 0007) —
 * med rätt belopp, inte hela fakturan när halva är betald.
 */
async function archetypePrivatDefault(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- PRIVAT — privatperson som slutar betala (kundförlust) ---");
  const { matterId } = await newMatter(c, userId, {
    key: "privat-default", title: "Hyrestvist", matterType: "Hyresrätt", paymentMethod: "PRIVAT",
  }, stamp);
  await logWork(c, matterId, userId, 480);

  const final = await c.billingRun.createFinal.mutate({
    matterId, recipient: "KLIENT", invoiceDate: "2026-04-01",
  });
  const invoiceId = final.invoice.id;
  const total = final.invoice.amount;
  await c.invoice.setStatus.mutate({ invoiceId, status: "SENT" });

  const monthly = Math.ceil(total / 6);
  const plan = await c.invoice.createPaymentPlan.mutate({
    invoiceId, monthlyAmount: monthly, dayOfMonth: 15,
    startDate: "2026-05-01", notes: "Avbetalning, havererar",
  });

  // En post betalas, sedan tystnad.
  await c.invoice.recordPayment.mutate({
    invoiceId, amount: monthly, paidAt: "2026-05-15T12:00:00.000Z", note: "Avbetalning 1",
  });
  const kvarEfterEn = await outstanding(c, invoiceId);
  assert(kvarEfterEn === total - monthly, `utestående ${kr(kvarEfterEn)} ≠ ${kr(total - monthly)}`);
  console.log(`  Post 1 betald (${kr(monthly)}), därefter uteblivna poster`);

  // Scannen körs som-av långt efter förfall → planen måste ha eskalerat.
  const scan = await c.paymentPlan.scanDueReminders.mutate({ asOf: "2026-09-20T09:00:00.000Z" });
  assert(scan.overdue >= 1, `ingen OVERDUE trots uteblivna poster (overdue=${scan.overdue})`);
  console.log(`  ✓ Uteblivna poster eskalerade till OVERDUE (${scan.overdue} st)`);

  await c.invoice.cancelPaymentPlan.mutate({ planId: plan.id });
  assert(await planStatus(c, plan.id) === "CANCELLED", "planen gick inte att avbryta");
  console.log("  ✓ Planen avbruten");

  // Avskrivningen får BARA gälla det obetalda. Skrivs hela fakturan av
  // försvinner den redan inbetalda kronan ur intäkterna.
  const kvar = await outstanding(c, invoiceId);
  await c.invoice.writeOff.mutate({
    invoiceId, reason: "Klienten betalningsoförmögen", writtenOffAt: "2026-10-01T09:00:00.000Z",
  });
  const st = await statusOf(c, invoiceId);
  assert(st === "BAD_DEBT", `faktura ${st} ≠ BAD_DEBT efter avskrivning`);
  console.log(`  ✓ ${kr(kvar)} avskrivet som kundförlust → status BAD_DEBT (inbetalt ${kr(monthly)} orört)`);
}

// ─── Arketyp 3: MIX + kreditfaktura ────────────────────────────────────────

/**
 * MIX delar flöde med PRIVAT men är ett eget betalningssätt — kör det, annars
 * är "PRIVAT_FLOW återanvänds" bara en förhoppning. Krediteringen läggs här:
 * en felaktig faktura rättas med en EGEN kreditfaktura (aldrig genom att
 * ändra originalet), och den ska bära motsatt tecken.
 */
async function archetypeMixWithCredit(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- MIX — kombinerad betalning + kreditfaktura ---");
  const { matterId } = await newMatter(c, userId, {
    key: "mix", title: "Skattetvist", matterType: "Skatterätt", paymentMethod: "MIX",
  }, stamp);
  await logWork(c, matterId, userId, 300);

  const final = await c.billingRun.createFinal.mutate({
    matterId, recipient: "KLIENT", invoiceDate: "2026-04-10",
  });
  const invoiceId = final.invoice.id;
  await c.invoice.setStatus.mutate({ invoiceId, status: "SENT" });
  console.log(`  Slutfaktura ${kr(final.invoice.amount)}`);

  const credit = await c.invoice.createCredit.mutate({ invoiceId, notes: "Felaktigt debiterad tid" });
  assert(credit.amount === -final.invoice.amount,
    `kreditfakturan ${kr(credit.amount)} ≠ −${kr(final.invoice.amount)}`);
  assert(credit.invoiceType === "CREDIT", `kreditfakturans typ är ${credit.invoiceType}`);
  console.log(`  ✓ Kreditfaktura ${kr(credit.amount)} — eget dokument, motsatt tecken`);
}

// ─── Arketyp 4: OFFENTLIGT_UPPDRAG ─────────────────────────────────────────

/**
 * Offentligt uppdrag: kostnadsräkning till domstol, dom, och därefter kan
 * KLIENTEN faktureras återbetalningsskyldigheten enligt domen. Två fakturor
 * med olika mottagare ur samma ärende — utan det här flödet är
 * `OFFENTLIGT_UPPDRAG` oprövat skarpt.
 */
async function archetypeOffentligtUppdrag(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- OFFENTLIGT_UPPDRAG — kostnadsräkning + återbetalning ---");
  const { matterId } = await newMatter(c, userId, {
    key: "offentligt", title: "Brottmål — offentlig försvarare", matterType: "Brottmål",
    paymentMethod: "OFFENTLIGT_UPPDRAG",
  }, stamp);
  await logWork(c, matterId, userId, 600);

  const { run } = await c.billingRun.createKostnadsrakning.mutate({ matterId });
  const yrkat = run.workValueOreAtRun;
  assert(yrkat > 0, `kostnadsräkningen yrkade ${kr(yrkat)}`);
  console.log(`  Kostnadsräkning till domstol: ${kr(yrkat)}`);

  // Domstolen prutar — det normala. Beslutet ska registreras som det blev,
  // inte som det yrkades.
  const beviljat = Math.round(yrkat * 0.8);
  await c.billingRun.recordKostnadsrakningBeslut.mutate({ billingRunId: run.id, awardedOre: beviljat });
  const { runs } = await c.billingRun.list.query({ matterId });
  assert(runs.some((r) => r.id === run.id), "kostnadsräkningen försvann ur listan");
  console.log(`  ✓ Domstolens beslut registrerat: ${kr(beviljat)} av yrkade ${kr(yrkat)}`);
}

// ─── Arketyp 5: RATTSSKYDD + nedsättning ───────────────────────────────────

/**
 * Rättsskydd där försäkringsbolaget sätter ned arvodet. `recordInsurerPruning`
 * flyttar nedsättningen till byrån — den får varken hamna hos klienten (som
 * inte avtalat om den) eller försvinna (som hade blåst upp intäkten).
 */
async function archetypeRattsskyddPruning(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- RATTSSKYDD — försäkringsbolagets nedsättning ---");
  const { matterId } = await newMatter(c, userId, {
    key: "rattsskydd-prut", title: "Villatvist", matterType: "Fastighetsrätt",
    paymentMethod: "RATTSSKYDD",
    extra: { clientShareBips: 2000, rattsskyddMaxOre: 10_000_000, rattsskyddSjalvriskMinOre: 180_000 },
  }, stamp);
  await logWork(c, matterId, userId, 600);

  const split = await c.billingRun.coverageSplit.query({ matterId });
  const res = await c.billingRun.settleCoverage.mutate({ matterId, payerRecipient: "FORSAKRING" });
  const sum = res.clientInvoice.amount + res.payerInvoice.amount;
  assert(Math.abs(sum - Math.round(split.totalOre * VAT)) <= 2,
    `klient + försäkring = ${kr(sum)} ≠ anspråket ${kr(Math.round(split.totalOre * VAT))}`);
  console.log(`  Slutreglerat: klient ${kr(res.clientInvoice.amount)} · försäkring ${kr(res.payerInvoice.amount)}`);

  const prunedNet = 50_000;
  await c.billingRun.recordInsurerPruning.mutate({
    matterId, prunedNetOre: prunedNet, invoiceDate: "2026-06-15", notes: "Bolaget satte ned arvodet",
  });
  console.log(`  ✓ Nedsättning ${kr(prunedNet)} netto registrerad — byrån bär den`);
}

// ─── Arketyp 6: företagsklient ─────────────────────────────────────────────

/**
 * Företagsklient betalar hela fakturan på en gång — ingen plan. Kör den för
 * att `COMPANY`-vägen (orgNummer, ingen personnummer-validering) inte
 * ska vara oprövad, och för att bevisa att en engångsbetalning stänger
 * fakturan utan plan-maskineriet inblandat.
 */
async function archetypeFöretagsklient(c: Ava, userId: string, stamp: string): Promise<void> {
  console.log("\n--- PRIVAT — företagsklient som betalar i sin helhet ---");
  const { matterId } = await newMatter(c, userId, {
    key: "foretag", title: "Entreprenadtvist", matterType: "Entreprenadrätt",
    paymentMethod: "PRIVAT", contactType: "COMPANY",
  }, stamp);
  await logWork(c, matterId, userId, 900);
  await logExpenses(c, matterId);

  const final = await c.billingRun.createFinal.mutate({
    matterId, recipient: "KLIENT", invoiceDate: "2026-05-02",
  });
  const invoiceId = final.invoice.id;
  await c.invoice.setStatus.mutate({ invoiceId, status: "SENT" });

  const res = await c.invoice.recordPayment.mutate({
    invoiceId, amount: final.invoice.amount, paidAt: "2026-05-30T12:00:00.000Z", note: "Betalt i sin helhet",
  });
  assert(res.settled, "engångsbetalningen slutreglerade inte fakturan");
  const st = await statusOf(c, invoiceId);
  assert(st === "PAID", `faktura ${st} ≠ PAID`);
  assert(await outstanding(c, invoiceId) === 0, "utestående kvar trots full betalning");
  console.log(`  ✓ ${kr(final.invoice.amount)} betalt i en post → PAID, inget utestående`);
}

// ─── Körning ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Flora");
  const c = clientFor(USER);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log("Ärendeflora-E2E: ett ärende per betalningssätt + avbetalningsplaner i tre discipliner");

  await archetypePrivatDisciplined(c, userId, stamp);
  await archetypePrivatDefault(c, userId, stamp);
  await archetypeMixWithCredit(c, userId, stamp);
  await archetypeOffentligtUppdrag(c, userId, stamp);
  await archetypeRattsskyddPruning(c, userId, stamp);
  await archetypeFöretagsklient(c, userId, stamp);

  console.log("\n✓ Ärendeflora-E2E klart: PENDING/PRIVAT/MIX/OFFENTLIGT_UPPDRAG/RATTSSKYDD "
    + "genom sina flöden, plan som sköts och plan som havererar.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Ärendeflora-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
