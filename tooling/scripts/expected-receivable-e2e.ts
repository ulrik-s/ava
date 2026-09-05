#!/usr/bin/env bun
/**
 * FÖRVÄNTAD DOMSTOLSBETALNING-E2E (#1060) — mot riktig Postgres över riktig HTTP.
 *
 * `expectedReceivable.*` (6 procedurer) hade noll e2e. En `ExpectedReceivable`
 * är en kostnadsräkning till domstol som Domstolsverket betalar — det finns
 * INGEN AVA-faktura att pricka av mot, och därför inget av det vanliga
 * fakturamaskineriet som fångar fel.
 *
 * ## Försiktighetsprincipen (3b-ii) är hela poängen
 *
 * `expectedAmount` är ett MEMO — vad byrån begärde. `settledAmount` är vad
 * domstolen faktiskt betalade, och bara det bokas. Mellanskillnaden
 * (prutningen) bokförs varken som intäkt eller som kundförlust.
 *
 * Den principen går att bryta på ett tyst sätt: om en förväntad fordran läckte
 * in i kundfordringsbryggan skulle byrån redovisa intäkt för pengar den
 * begärt men inte fått. Testet stämmer därför av HELA AR-bryggan före och
 * efter — den ska vara bokstavligen oförändrad.
 *
 * ## Sömmen som aldrig testats
 *
 * `candidates` producerar matchningsunderlaget som `matchReceivables` (#175)
 * konsumerar vid camt-import. Båda sidor är enhetstestade — men var för sig,
 * mot egna fixturer. Att serverns faktiska utdata passar matcharens faktiska
 * indata har ingen kontroll bevisat.
 *
 * Testet kör därför den riktiga sömmen: hämtar kandidater från servern och
 * matar dem, oförändrade, in i den skarpa matchningsfunktionen tillsammans med
 * en camt-transaktion i det verifierade referensformatet
 * `<ärendenr> <målnr> <advokat>`.
 *
 *   bun run e2e:expected-receivable
 */

import type { ArBridge } from "@/lib/shared/ar-summary";
import { matchReceivables, type ReceivableCandidate } from "@/lib/shared/payments/match-receivables";
import { asId } from "@/lib/shared/schemas/ids";
import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

const USER = "anna-fordran@byra.se";
/** Domstolens målnummer — den starkaste matchningsnyckeln (#173). */
const COURT_CASE = "3288-26";
/** Begärt av domstolen. Domstolen prutar; det är normalfallet, inte undantaget. */
const BEGART_ORE = 2_032_500;
const UTBETALT_ORE = 1_626_000;

/** Alla bryggtermer. `satisfies` gör listan uttömmande: läggs en term till i
 *  `ArBridge` utan att hamna här slutar den tyst att kontrolleras. */
const BRIDGE_TERMS = [
  "fakturerat", "krediterat", "justerat", "inbetalt", "konstateradKundforlust",
  "utestaende", "ejForfallet", "forfallet", "nettoRealiserat",
] as const satisfies ReadonlyArray<keyof ArBridge>;

// ─── Riggning ──────────────────────────────────────────────────────────────

async function matterWithCourtCase(c: Ava, userId: string, stamp: string): Promise<{ id: string; matterNumber: string }> {
  const client = await c.contacts.create.mutate({
    name: `Fordringsklient ${stamp}`, contactType: "PERSON",
  });
  const m = await c.matter.create.mutate({
    matterNumber: `FORDRAN-${stamp}`, title: `Brottmål med kostnadsräkning ${stamp}`,
    matterType: "Brottmål", paymentMethod: "RATTSHJALP", responsibleLawyerId: userId,
    courtCaseNumber: COURT_CASE,
  });
  await c.matter.addContact.mutate({ matterId: m.id, contactId: client.id, role: "KLIENT" });
  return { id: m.id, matterNumber: m.matterNumber };
}

/** Camt-transaktion i det format Domstolsverket faktiskt använder. */
function courtPayment(matterNumber: string, amountOre: number, reference: string) {
  return {
    reference,
    amountOre,
    currency: "SEK",
    valueDate: "2026-06-15",
    debtorName: "DOMSTOLSVERKET",
    creditDebit: "CRDT" as const,
    structuredRefs: [],
    // Verifierat referensformat: ärendenummer, målnummer, ansvarig advokat.
    freeTexts: [`${matterNumber} ${COURT_CASE} ENOKSSON`],
  };
}

// ─── Kontroller ────────────────────────────────────────────────────────────

/** Registrering: fordran föds PENDING och syns på ärendet. */
async function verifyCreate(c: Ava, matterId: string): Promise<string> {
  console.log("\n--- Registrera förväntad domstolsbetalning ---");
  const r = await c.expectedReceivable.create.mutate({
    matterId, description: "Kostnadsräkning till tingsrätten", expectedAmount: BEGART_ORE,
  });
  assert(r.status === "PENDING", `ny fordran har status ${r.status}, inte PENDING`);
  assert(r.expectedAmount === BEGART_ORE, `begärt belopp ${kr(r.expectedAmount)} ≠ ${kr(BEGART_ORE)}`);

  const list = await c.expectedReceivable.list.query({ matterId });
  assert(list.some((x) => String(x.id) === String(r.id)), "fordran saknas i ärendets lista");
  console.log(`  ✓ PENDING på ${kr(BEGART_ORE)}, kopplad till ärendet`);
  return String(r.id);
}

/**
 * Sömmen: serverns `candidates` → skarp `matchReceivables`. Ingen fixtur
 * emellan — det är precis det mellanrummet enhetstesterna inte når över.
 */
async function verifyCamtSeam(c: Ava, receivableId: string, matterNumber: string): Promise<void> {
  console.log("\n--- Sömmen: candidates → matchReceivables (#175) ---");
  const raw = await c.expectedReceivable.candidates.query();
  const mine = raw.find((x) => x.id === receivableId);
  assert(mine !== undefined, "den öppna fordran saknas bland matchningskandidaterna");

  // Matchningsnycklarna MÅSTE följa med — utan målnummer kan camt-fri texten
  // aldrig knytas till fordran, och den automatiska avprickningen är död.
  assert(mine.courtCaseNumber === COURT_CASE,
    `målnumret följde inte med till kandidaten: ${String(mine.courtCaseNumber)}`);
  assert(mine.matterNumber === matterNumber,
    `ärendenumret följde inte med: ${String(mine.matterNumber)}`);
  console.log(`  ✓ Kandidaten bär båda nycklarna: ${mine.matterNumber} / ${mine.courtCaseNumber}`);

  // Serverns rader in i matcharen, oförändrade så när som på brandningen.
  const candidates: ReceivableCandidate[] = raw.map((x) => ({
    id: asId<"ExpectedReceivableId">(x.id),
    matterNumber: x.matterNumber,
    courtCaseNumber: x.courtCaseNumber,
    expectedAmount: x.expectedAmount,
    settledReferences: [],
  }));

  const tx = courtPayment(matterNumber, UTBETALT_ORE, "CAMT-REF-1");
  const { suggestions } = matchReceivables([tx], candidates);
  const hit = suggestions.find((s) => String(s.receivableId) === receivableId);
  assert(hit !== undefined, "camt-transaktionen matchade inte fordran trots rätt målnummer i fri texten");
  assert(hit.amountOre === UTBETALT_ORE,
    `förslaget avser ${kr(hit.amountOre)}, inte det utbetalda ${kr(UTBETALT_ORE)}`);
  console.log(`  ✓ Camt-fri texten "${tx.freeTexts[0]}" gav förslag på ${kr(hit.amountOre)}`);
}

/**
 * Avprickning enligt 3b-ii: det UTBETALDA bokas, det begärda står kvar som
 * memo. Skrivs `expectedAmount` över med utfallet försvinner spåret av vad
 * byrån faktiskt begärde — och därmed möjligheten att se hur mycket domstolen
 * prutade.
 */
async function verifySettleKeepsMemo(c: Ava, receivableId: string): Promise<void> {
  console.log("\n--- Avprickning: utfallet bokas, begärt står kvar som memo ---");
  const settled = await c.expectedReceivable.settle.mutate({
    id: asId<"ExpectedReceivableId">(receivableId),
    settledAmount: UTBETALT_ORE,
    settledAt: "2026-06-15T00:00:00.000Z",
    paymentReference: "CAMT-REF-1",
  });
  assert(settled.status === "SETTLED", `status ${settled.status} ≠ SETTLED`);
  assert(settled.settledAmount === UTBETALT_ORE, `utbetalt ${kr(settled.settledAmount ?? 0)} ≠ ${kr(UTBETALT_ORE)}`);
  assert(settled.expectedAmount === BEGART_ORE,
    `det begärda beloppet skrevs över (${kr(settled.expectedAmount)}) — prutningen går inte längre att se`);

  const prutat = BEGART_ORE - UTBETALT_ORE;
  console.log(`  ✓ Begärt ${kr(BEGART_ORE)}, utbetalt ${kr(UTBETALT_ORE)}, prutat ${kr(prutat)} — båda bevarade`);
}

/**
 * Dubblettskyddet som FAKTISKT bär: en avprickad fordran försvinner ur
 * kandidatlistan. Körs samma camt-fil om (vilket banken gör) får matcharen
 * inte längre se fordran, och kan därför inte föreslå den igen.
 */
async function verifyNoDoubleSettle(c: Ava, receivableId: string, matterNumber: string): Promise<void> {
  console.log("\n--- Omkörd camt-fil kan inte pricka av samma fordran igen ---");
  const raw = await c.expectedReceivable.candidates.query();
  assert(!raw.some((x) => x.id === receivableId),
    "den avprickade fordran ligger kvar bland kandidaterna — samma betalning kan prickas av två gånger");

  const candidates: ReceivableCandidate[] = raw.map((x) => ({
    id: asId<"ExpectedReceivableId">(x.id), matterNumber: x.matterNumber,
    courtCaseNumber: x.courtCaseNumber, expectedAmount: x.expectedAmount, settledReferences: [],
  }));
  const { suggestions } = matchReceivables([courtPayment(matterNumber, UTBETALT_ORE, "CAMT-REF-1")], candidates);
  assert(!suggestions.some((s) => String(s.receivableId) === receivableId),
    "omkörningen föreslog samma fordran igen");
  console.log("  ✓ Ur kandidatlistan → ingen dubbelavprickning vid omimport");
}

/**
 * FÖRSIKTIGHETSPRINCIPEN. En förväntad domstolsbetalning är ingen faktura och
 * får inte synas i kundfordringsbryggan — varken som fakturerat eller som
 * utestående. Läcker den in redovisar byrån intäkt för pengar den begärt men
 * inte fått, vilket är precis vad 3b-ii finns för att förhindra.
 */
async function verifyArBridgeUntouched(c: Ava, matterId: string, before: ArBridge): Promise<void> {
  console.log("\n--- Försiktighetsprincipen: AR-bryggan orörd ---");
  await c.expectedReceivable.create.mutate({
    matterId, description: "Ytterligare kostnadsräkning", expectedAmount: 5_000_00,
  });
  const after = await c.reports.arSummary.query({ from: "2026-01-01", to: "2026-12-31" });

  for (const term of BRIDGE_TERMS) {
    assert(after.bridge[term] === before[term],
      `${term} ändrades ${kr(before[term])} → ${kr(after.bridge[term])} av en förväntad fordran `
      + "— den bokförs som om den vore en faktura");
  }
  console.log(`  ✓ Alla ${BRIDGE_TERMS.length} bryggtermer oförändrade — fordran bokförs inte som intäkt`);
}

/** Avbruten fordran (domstolen avslog helt) ska ut ur kandidaterna. */
async function verifyCancel(c: Ava, matterId: string): Promise<void> {
  console.log("\n--- Avbruten fordran ---");
  const r = await c.expectedReceivable.create.mutate({
    matterId, description: "Felregistrerad kostnadsräkning", expectedAmount: 1_000_00,
  });
  await c.expectedReceivable.cancel.mutate({ id: asId<"ExpectedReceivableId">(String(r.id)) });

  const cands = await c.expectedReceivable.candidates.query();
  assert(!cands.some((x) => x.id === String(r.id)),
    "avbruten fordran ligger kvar bland kandidaterna och kan prickas av av misstag");
  console.log("  ✓ Ur kandidatlistan");
}

/** Memo-fälten ska gå att rätta medan fordran är öppen. */
async function verifyUpdateMemo(c: Ava, matterId: string): Promise<void> {
  console.log("\n--- Rätta memo-fälten medan fordran är öppen ---");
  const r = await c.expectedReceivable.create.mutate({
    matterId, description: "Preliminär kostnadsräkning", expectedAmount: 900_00,
  });
  const uppdaterad = await c.expectedReceivable.update.mutate({
    id: asId<"ExpectedReceivableId">(String(r.id)),
    description: "Justerad kostnadsräkning", expectedAmount: 1_100_00,
  });
  assert(uppdaterad.expectedAmount === 1_100_00, `begärt belopp uppdaterades inte: ${kr(uppdaterad.expectedAmount)}`);
  assert(uppdaterad.description === "Justerad kostnadsräkning", "beskrivningen uppdaterades inte");
  assert(uppdaterad.status === "PENDING", `statusen ändrades till ${uppdaterad.status} av en memo-rättelse`);
  console.log("  ✓ Belopp och beskrivning rättade, status kvar PENDING");
}

// ─── Körning ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Fordran");
  const c = clientFor(USER);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log("Förväntad domstolsbetalning-E2E: 3b-ii, camt-sömmen och dubblettskyddet");

  const matter = await matterWithCourtCase(c, userId, stamp);

  // Baslinje INNAN någon fordran finns — allt annat i databasen får vara som det är.
  const baseline = await c.reports.arSummary.query({ from: "2026-01-01", to: "2026-12-31" });
  const before: ArBridge = { ...baseline.bridge };

  const receivableId = await verifyCreate(c, matter.id);
  await verifyCamtSeam(c, receivableId, matter.matterNumber);
  await verifySettleKeepsMemo(c, receivableId);
  await verifyNoDoubleSettle(c, receivableId, matter.matterNumber);
  await verifyArBridgeUntouched(c, matter.id, before);
  await verifyCancel(c, matter.id);
  await verifyUpdateMemo(c, matter.id);

  console.log("\n✓ Förväntad domstolsbetalning-E2E klart: memo bevarat, camt-sömmen håller, bryggan orörd.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Förväntad domstolsbetalning-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
