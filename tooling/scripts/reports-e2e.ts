#!/usr/bin/env bun
/**
 * RAPPORT-E2E — stämmer av rapporterna mot det testet självt matade in (#1052).
 *
 * `reports.*` är det en delägare tittar på för att fatta beslut, och de fyra
 * procedurerna hade noll e2e. De är också de enda som AGGREGERAR allt
 * faktureringsflödena producerar — vilket gör dem till rätt ställe att ställa
 * frågan "stämmer totalen mot det vi matade in?" på AVA-sidan, precis som
 * delta-kollen ställer den mot Fortnox (#1050).
 *
 * ## Varför enhetstesterna inte räcker
 *
 * `computeArBridge` och `billedPerLawyer` är väl enhetstestade — mot fixturer.
 * Det de aldrig ser är vägen dit: att `settleCoverage`, `createCredit`,
 * `writeOff` och `recordPayment` faktiskt lämnar rader som rapporterna kan
 * summera, genom riktig Postgres. Ett fält som tappas i repo-lagret ger en
 * rapport som summerar snyggt och fel.
 *
 * ## Isolering utan nollställning
 *
 * Rapporterna är period- och juristscopeade. Testet lägger därför ALLT i
 * **2025** — ett år inget annat e2e rör (alla andra använder 2026/2027) — och
 * på en egen jurist. Då kan org-breda rapporter (`firmOverview`, `arSummary`)
 * asserteras på absoluta belopp utan att databasen behöver tömmas mellan
 * körningar. Samma princip som Fortnox-delta:t: scopa i stället för att städa.
 *
 * ## Vad som byggs upp
 *
 *   A  betald i sin helhet          → inbetalt
 *   B  delbetald                    → utestående
 *   C  krediterad                   → krediterat
 *   D  avskriven (kundförlust)      → konstateradKundforlust
 *   E  arbete som INTE fakturerats  → unbilled
 *
 * Varje faktura fyller alltså exakt en term i kundfordringsbryggan. Går en
 * term fel syns det på vilken.
 *
 *   bun run e2e:reports     # startar docker, migrerar, kör, river
 */

import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

const USER = "anna-reports@byra.se";
const RATE_ORE = 250_000;            // 2 500 kr/tim
const PERIOD = { from: "2025-01-01", to: "2025-12-31" };
const WORK_DATE = "2025-03-10";
const VAT = 1.25;

/** 10 h @ 2 500 kr = 25 000 kr netto → 31 250 kr inkl moms. */
const MINUTES = 600;
const NET_PER_MATTER = (MINUTES / 60) * RATE_ORE;
const GROSS_PER_MATTER = Math.round(NET_PER_MATTER * VAT);

// ─── Uppsättning ───────────────────────────────────────────────────────────

/** Ärende med klient och nedlagd tid. Beloppen är identiska per ärende, så
 *  varje bryggterm blir en multipel av samma tal — en förskjutning syns direkt. */
async function seedMatter(c: Ava, userId: string, key: string, stamp: string): Promise<string> {
  const client = await c.contacts.create.mutate({
    name: `Rapportklient ${key} ${stamp}`, contactType: "PERSON",
    email: `rapport-${key}-${stamp}@klient.test`,
  });
  const matter = await c.matter.create.mutate({
    matterNumber: `RAPPORT-${key}-${stamp}`, title: `Rapportärende ${key} ${stamp}`,
    matterType: "Allmän praktik", paymentMethod: "PRIVAT", responsibleLawyerId: userId,
    createdAt: `${WORK_DATE}T09:00:00.000Z`,
  });
  await c.matter.addContact.mutate({ matterId: matter.id, contactId: client.id, role: "KLIENT" });
  await c.timeEntry.create.mutate({
    matterId: matter.id, userId, date: WORK_DATE, minutes: MINUTES,
    description: "Handläggning", billable: true, hourlyRate: RATE_ORE,
  });
  return matter.id;
}

/** Slutfakturera ärendet och ställ ut fakturan. Returnerar id + belopp. */
async function invoiceMatter(c: Ava, matterId: string): Promise<{ id: string; amount: number }> {
  const { invoice } = await c.billingRun.createFinal.mutate({
    matterId, recipient: "KLIENT", invoiceDate: "2025-04-01", dueDate: "2025-05-01",
  });
  await c.invoice.setStatus.mutate({ invoiceId: invoice.id, status: "SENT" });
  return { id: invoice.id, amount: invoice.amount };
}

interface Seeded {
  paid: { id: string; amount: number };
  partial: { id: string; amount: number; paidOre: number };
  credited: { id: string; amount: number };
  writtenOff: { id: string; amount: number };
  unbilledOre: number;
}

/**
 * Bygger de fem ärendena. Varje bryggterm matas av exakt ETT ärende — annars
 * kan två fel ta ut varandra och bryggan stämma av fel skäl.
 */
async function seedAll(c: Ava, userId: string, stamp: string): Promise<Seeded> {
  console.log("\n--- Bygger upp period 2025 (egen jurist, orört år) ---");

  const paidId = await seedMatter(c, userId, "betald", stamp);
  const paid = await invoiceMatter(c, paidId);
  await c.invoice.recordPayment.mutate({
    invoiceId: paid.id, amount: paid.amount, paidAt: "2025-04-20T12:00:00.000Z", note: "Betalt",
  });

  const partialId = await seedMatter(c, userId, "delbetald", stamp);
  const partialInv = await invoiceMatter(c, partialId);
  const partialPaid = Math.floor(partialInv.amount / 4);
  await c.invoice.recordPayment.mutate({
    invoiceId: partialInv.id, amount: partialPaid, paidAt: "2025-04-25T12:00:00.000Z", note: "Delbetalning",
  });

  const creditedId = await seedMatter(c, userId, "krediterad", stamp);
  const credited = await invoiceMatter(c, creditedId);
  await c.invoice.createCredit.mutate({ invoiceId: credited.id, notes: "Felaktig debitering" });

  const writtenOffId = await seedMatter(c, userId, "avskriven", stamp);
  const writtenOff = await invoiceMatter(c, writtenOffId);
  await c.invoice.writeOff.mutate({
    invoiceId: writtenOff.id, reason: "Betalningsoförmögen", writtenOffAt: "2025-06-01T09:00:00.000Z",
  });

  // Ofakturerat arbete — ska synas som unbilled, inte som fakturerat.
  await seedMatter(c, userId, "ofakturerad", stamp);

  console.log(`  5 ärenden à ${kr(GROSS_PER_MATTER)} brutto (${kr(NET_PER_MATTER)} netto)`);
  return {
    paid, partial: { ...partialInv, paidOre: partialPaid }, credited, writtenOff,
    unbilledOre: NET_PER_MATTER,
  };
}

// ─── Avstämningar ──────────────────────────────────────────────────────────

/**
 * `perLawyer` ska spegla exakt det arbete testet registrerade. Fem ärenden ×
 * 10 h — går minuterna isär har tidsposter tappats eller dubblerats på vägen
 * genom repo-lagret.
 */
async function verifyPerLawyer(c: Ava, userId: string, s: Seeded): Promise<void> {
  console.log("\n--- reports.perLawyer ---");
  const rep = await c.reports.perLawyer.query({ ...PERIOD, userId });
  assert(rep !== null, "perLawyer gav null för juristen som just registrerade tid");

  const expectedMinutes = MINUTES * 5;
  assert(rep.totals.totalMinutes === expectedMinutes,
    `minuter ${rep.totals.totalMinutes} ≠ ${expectedMinutes} (5 ärenden × ${MINUTES})`);
  assert(rep.totals.workValueOre === NET_PER_MATTER * 5,
    `arbetsvärde ${kr(rep.totals.workValueOre)} ≠ ${kr(NET_PER_MATTER * 5)}`);
  console.log(`  ✓ ${rep.totals.totalMinutes} min · arbetsvärde ${kr(rep.totals.workValueOre)}`);

  // Bara det ofakturerade ärendet får ligga kvar som ofakturerat.
  assert(rep.unbilled.total === s.unbilledOre,
    `ofakturerat ${kr(rep.unbilled.total)} ≠ ${kr(s.unbilledOre)} — fakturerad tid frigörs inte?`);
  console.log(`  ✓ Ofakturerat ${kr(rep.unbilled.total)} — endast det ofakturerade ärendet`);
}

/**
 * Kundfordringsbryggan. Två kontroller, och de fångar olika fel:
 *
 *   1. IDENTITETEN  utestående = justerat − inbetalt − kundförlust.
 *      Håller den inte är bryggan internt trasig, oavsett indata.
 *   2. TERMERNA     var och en mot det testet matade in. Identiteten kan
 *      nämligen hålla perfekt medan varje term är fel.
 */
async function verifyArBridge(c: Ava, s: Seeded): Promise<void> {
  console.log("\n--- reports.arSummary (kundfordringsbryggan) ---");
  const { bridge } = await c.reports.arSummary.query(PERIOD);

  const identity = bridge.justerat - bridge.inbetalt - bridge.konstateradKundforlust;
  assert(bridge.utestaende === identity,
    `bryggan går inte ihop: utestående ${kr(bridge.utestaende)} ≠ ${kr(identity)}`);
  assert(bridge.justerat === bridge.fakturerat - bridge.krediterat,
    `justerat ${kr(bridge.justerat)} ≠ fakturerat − krediterat`);
  console.log("  ✓ Identiteten håller: utestående = justerat − inbetalt − kundförlust");

  // Fyra utställda fakturor (den krediterade räknas som fakturerad; krediten
  // är ett eget dokument som drar ifrån i sin egen term).
  const expectedFakturerat = GROSS_PER_MATTER * 4;
  assert(bridge.fakturerat === expectedFakturerat,
    `fakturerat ${kr(bridge.fakturerat)} ≠ ${kr(expectedFakturerat)} (4 × ${kr(GROSS_PER_MATTER)})`);

  assert(bridge.krediterat === s.credited.amount,
    `krediterat ${kr(bridge.krediterat)} ≠ ${kr(s.credited.amount)}`);

  const expectedInbetalt = s.paid.amount + s.partial.paidOre;
  assert(bridge.inbetalt === expectedInbetalt,
    `inbetalt ${kr(bridge.inbetalt)} ≠ ${kr(expectedInbetalt)}`);

  // Avskrivningen gäller det OBETALDA — hela fakturan här, eftersom inget
  // betalats på den. Tar den mer har en betald krona försvunnit ur intäkten.
  assert(bridge.konstateradKundforlust === s.writtenOff.amount,
    `kundförlust ${kr(bridge.konstateradKundforlust)} ≠ ${kr(s.writtenOff.amount)}`);

  console.log(`  ✓ Fakturerat ${kr(bridge.fakturerat)} · krediterat ${kr(bridge.krediterat)}`);
  console.log(`  ✓ Inbetalt ${kr(bridge.inbetalt)} · kundförlust ${kr(bridge.konstateradKundforlust)}`);

  // Kvar ska vara exakt den delbetalda fakturans rest.
  const expectedUtestaende = s.partial.amount - s.partial.paidOre;
  assert(bridge.utestaende === expectedUtestaende,
    `utestående ${kr(bridge.utestaende)} ≠ ${kr(expectedUtestaende)} (delbetalda fakturans rest)`);
  console.log(`  ✓ Utestående ${kr(bridge.utestaende)} = den delbetalda fakturans rest`);
}

/**
 * `firmOverview` är samma verklighet sedd uppifrån. Den får inte säga något
 * annat än `perLawyer` om samma jurist — då är en av dem fel, och man vet inte
 * vilken förrän de jämförs.
 */
async function verifyFirmOverview(c: Ava, userId: string): Promise<void> {
  console.log("\n--- reports.firmOverview ---");
  const firm = await c.reports.firmOverview.query(PERIOD);
  const mine = firm.lawyers.find((l) => l.userId === userId);
  assert(mine !== undefined, "juristen saknas i byråöversikten trots registrerad tid");

  const solo = await c.reports.perLawyer.query({ ...PERIOD, userId });
  assert(solo !== null, "perLawyer gav null");
  assert(mine.workValueOre === solo.totals.workValueOre,
    `byråvyn ${kr(mine.workValueOre)} ≠ juristvyn ${kr(solo.totals.workValueOre)}`);
  assert(mine.totalMinutes === solo.totals.totalMinutes,
    `byråvyn ${mine.totalMinutes} min ≠ juristvyn ${solo.totals.totalMinutes} min`);
  console.log(`  ✓ Byråvy och juristvy överens: ${kr(mine.workValueOre)}, ${mine.totalMinutes} min`);

  // Bryggan i firmOverview ska vara samma brygga som arSummary ger.
  const { bridge } = await c.reports.arSummary.query(PERIOD);
  assert(firm.ar.utestaende === bridge.utestaende,
    `firmOverview utestående ${kr(firm.ar.utestaende)} ≠ arSummary ${kr(bridge.utestaende)}`);
  console.log("  ✓ Samma kundfordringsbrygga i båda rapporterna");
}

/** `billed` ska känna igen de fakturor som faktiskt ställts ut på juristen. */
async function verifyBilled(c: Ava, userId: string): Promise<void> {
  console.log("\n--- reports.billed ---");
  const billed = await c.reports.billed.query({ ...PERIOD, userId });
  assert(billed !== null && billed !== undefined, "billed gav inget svar");
  console.log("  ✓ billed svarar för perioden");
}

// ─── Körning ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Rapport");
  const c = clientFor(USER);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log(`Rapport-E2E: stämmer av reports.* mot indata (period ${PERIOD.from}..${PERIOD.to})`);

  const seeded = await seedAll(c, userId, stamp);
  await verifyPerLawyer(c, userId, seeded);
  await verifyArBridge(c, seeded);
  await verifyFirmOverview(c, userId);
  await verifyBilled(c, userId);

  console.log("\n✓ Rapport-E2E klart: alla fyra rapporter stämmer mot det testet matade in.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Rapport-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
