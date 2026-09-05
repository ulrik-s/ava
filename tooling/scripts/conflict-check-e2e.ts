#!/usr/bin/env bun
/**
 * JÄVSKONTROLL-E2E (#1056) — mot riktig Postgres över riktig HTTP.
 *
 * `conflict.check` hade noll e2e trots att det är byråns mest juridiskt laddade
 * funktion: missad jäv är en disciplinär fråga, inte en bugg.
 *
 * ## Vad reglerna kräver
 *
 * Vägledande regler om god advokatsed (VRGA) p. 3.2.1 — advokaten får inte anta
 * uppdraget vid intressekonflikt ELLER beaktansvärd risk för sådan. Konflikt
 * föreligger bl.a. när advokaten
 *
 *   1. biträder eller HAR BITRÄTT motparten i saken,
 *   2. biträder annan klient i SAMMA sak med motstridiga intressen,
 *   3. biträder annan klient i NÄRALIGGANDE sak med motstridiga intressen,
 *   4. har sekretessbelagd kunskap som kan ha betydelse i saken.
 *
 * VRGA p. 3.5 — **byråjäv (smittoregeln)**: intressekonflikt för någon annan på
 * byrån är normalt också advokatens. Även icke-advokater smittar
 * (Advokatsamfundets vägledande uttalanden). Kontrollen måste därför omfatta
 * HELA byrån, inte den egna ärendeportföljen.
 *
 * ## Vad systemet gör — och inte gör
 *
 * `conflict.check` avgör INTE om intressena är motstridiga. Den kan inte det:
 * "näraliggande sak" och "motstridiga intressen" är juridiska bedömningar.
 * Systemet levererar UNDERLAGET — vilka av byråns ärenden personen förekommer
 * i och i vilken roll — och loggar att kontrollen gjordes. Bedömningen är
 * advokatens.
 *
 * Testet asserterar därför på underlaget, aldrig på ett "jävig ja/nej". Ett
 * grönt test betyder att kontrollen ger rätt underlag, inte att ett uppdrag är
 * rent.
 *
 * ## Vad som testas
 *
 *   Motpart i annan jurists ärende   → träff  (3.2.1 p.1 + 3.5 byråjäv)
 *   Avslutat ärende                  → träff  (3.2.1 p.1 "har biträtt")
 *   Personnummer trots namnbyte      → träff  (identitet ≠ namnsträng)
 *   Stavningsvariant                 → träff  (fuzzy)
 *   Obesläktad person                → 0 träffar, men loggad kontroll
 *   Varje kontroll                   → i historiken (dokumentationsplikt)
 *
 *   bun run e2e:conflict-check     # startar docker, migrerar, kör, river
 */

import type { ContactId } from "@/lib/shared/schemas/ids";
import {
  assert, clientFor, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

/** Två jurister på samma byrå — smittoregeln testas bara om ärendena ägs av olika. */
const ANNA = "anna-jav@byra.se";
const BERTIL = "bertil-jav@byra.se";

/** Personnummer som binder ihop samma person under olika namn. */
const KARIN_PNR = "19720914-0055";

/** Brandat id — jämförs direkt mot `contactId` i kontrollens svar. */
interface Party { id: ContactId; name: string }

// ─── Uppsättning ───────────────────────────────────────────────────────────

async function contact(c: Ava, name: string, extra: Record<string, unknown> = {}): Promise<Party> {
  const created = await c.contacts.create.mutate({ name, contactType: "PERSON", ...extra });
  return { id: created.id, name };
}

/** Ett ärende att lägga upp — samlat, för sex lösa parametrar är fler än taket. */
interface MatterSpec {
  lawyerId: string;
  key: string;
  stamp: string;
  klient: Party;
  motpart?: Party;
  status?: "ACTIVE" | "CLOSED";
}

/** Ärende med klient + valfri motpart, ägt av angiven jurist. */
async function matterWith(c: Ava, spec: MatterSpec): Promise<void> {
  const m = await c.matter.create.mutate({
    matterNumber: `JAV-${spec.key}-${spec.stamp}`, title: `Jävsärende ${spec.key} ${spec.stamp}`,
    matterType: "Allmän praktik", paymentMethod: "PRIVAT",
    responsibleLawyerId: spec.lawyerId, status: spec.status ?? "ACTIVE",
  });
  await c.matter.addContact.mutate({ matterId: m.id, contactId: spec.klient.id, role: "KLIENT" });
  if (spec.motpart) {
    await c.matter.addContact.mutate({ matterId: m.id, contactId: spec.motpart.id, role: "MOTPART" });
  }
}

interface Fixture { viktor: Party; greta: Party; karinA: Party; karinB: Party; kristoffer: Party }

async function seed(c: Ava, annaId: string, bertilId: string, stamp: string): Promise<Fixture> {
  console.log("\n--- Bygger upp byråns ärendehistorik ---");

  // Bertils ärende med Viktor som MOTPART. Anna har aldrig rört det — det är
  // hela poängen med smittoregeln.
  const viktor = await contact(c, `Viktor Vinge ${stamp}`);
  const klientB = await contact(c, `Bertils klient ${stamp}`);
  await matterWith(c, { lawyerId: bertilId, key: "bertil-motpart", stamp, klient: klientB, motpart: viktor });

  // AVSLUTAT ärende. "har biträtt" i 3.2.1 p.1 är dåtid — jäv preskriberas inte
  // av att ärendet stängs.
  const greta = await contact(c, `Greta Gammal ${stamp}`);
  await matterWith(c, { lawyerId: annaId, key: "avslutat", stamp, klient: greta, status: "CLOSED" });

  // Samma person, två namn, samma personnummer. Ett namnbyte får inte gömma
  // någon för kontrollen.
  const karinA = await contact(c, `Karin Nilsson ${stamp}`, { personalNumber: KARIN_PNR });
  const karinB = await contact(c, `Karin Nilsson-Berg ${stamp}`, { personalNumber: KARIN_PNR });
  await matterWith(c, { lawyerId: annaId, key: "karin-fore", stamp, klient: karinA });
  await matterWith(c, { lawyerId: bertilId, key: "karin-efter", stamp, klient: karinB });

  // Stavningsvariant — namn stavas sällan likadant två gånger i verkligheten.
  const kristoffer = await contact(c, `Kristoffer Kristoffersson ${stamp}`);
  const klientK = await contact(c, `Klient K ${stamp}`);
  await matterWith(c, { lawyerId: annaId, key: "stavning", stamp, klient: klientK, motpart: kristoffer });

  console.log("  5 ärenden hos två jurister: motpart, avslutat, namnbyte ×2, stavningsvariant");
  return { viktor, greta, karinA, karinB, kristoffer };
}

// ─── Kontroller ────────────────────────────────────────────────────────────

/**
 * VRGA 3.5 — byråjäv. Anna slår på en person som bara förekommer i BERTILS
 * ärende. Får kontrollen bara träff i den egna portföljen är den värdelös:
 * smittoregeln är huvudregeln, inte undantaget.
 */
async function verifyByrajav(c: Ava, f: Fixture): Promise<void> {
  console.log("\n--- VRGA 3.5: byråjäv (annan jurists ärende) ---");
  const res = await c.conflict.check.mutate({ searchTerm: f.viktor.name, searchType: "both" });
  assert(res.matchCount > 0, `ingen träff på ${f.viktor.name} trots motpart i byråns ärende`);

  const hit = res.results.find((r) => r.contactId === f.viktor.id);
  assert(hit !== undefined, "personen hittades inte bland träffarna");
  assert(hit.role === "MOTPART", `rollen redovisas som ${hit.role}, inte MOTPART`);
  assert(hit.matterNumber.length > 0, "ärendenumret saknas — underlaget går inte att följa upp");
  console.log(`  ✓ Träff i ${hit.matterNumber} med roll ${hit.role} (annan jurists ärende)`);
}

/**
 * VRGA 3.2.1 p.1 — "biträder ELLER HAR BITRÄTT". Ett avslutat ärende är
 * fortfarande jävsgrundande; en kontroll som bara ser pågående uppdrag ger
 * falsk trygghet.
 */
async function verifyAvslutatArende(c: Ava, f: Fixture): Promise<void> {
  console.log("\n--- VRGA 3.2.1 p.1: avslutat ärende (\"har biträtt\") ---");
  const res = await c.conflict.check.mutate({ searchTerm: f.greta.name, searchType: "name" });
  const hit = res.results.find((r) => r.contactId === f.greta.id);
  assert(hit !== undefined, "avslutat ärende gav ingen träff — jäv upphör inte när ärendet stängs");
  console.log(`  ✓ Träff i det avslutade ärendet ${hit.matterNumber}`);
}

/**
 * Identitet är personnumret, inte namnsträngen. Samma person under två namn
 * ska ge båda ärendena — annars gömmer ett namnbyte en jävssituation.
 */
async function verifyPersonnummer(c: Ava, f: Fixture): Promise<void> {
  console.log("\n--- Personnummer slår igenom namnbyte ---");
  const res = await c.conflict.check.mutate({ searchTerm: KARIN_PNR, searchType: "personalNumber" });
  const ids = new Set(res.results.map((r) => r.contactId));
  assert(ids.has(f.karinA.id), "hittade inte personen under det gamla namnet");
  assert(ids.has(f.karinB.id), "hittade inte personen under det nya namnet");
  console.log(`  ✓ Båda namnformerna hittade på ${KARIN_PNR} (${res.matchCount} träffar)`);
}

/** Fuzzy namnmatch: stavningsvariant ska träffa, men inte vem som helst. */
async function verifyStavning(c: Ava, f: Fixture, stamp: string): Promise<void> {
  console.log("\n--- Fuzzy namnmatch ---");
  const variant = `Christoffer Christoffersson ${stamp}`;
  const res = await c.conflict.check.mutate({ searchTerm: variant, searchType: "name" });
  assert(res.results.some((r) => r.contactId === f.kristoffer.id),
    `stavningsvarianten "${variant}" hittade inte ${f.kristoffer.name}`);
  console.log(`  ✓ "${variant}" hittade ${f.kristoffer.name}`);
}

/**
 * En obesläktad person ska ge noll träffar — men kontrollen ska ändå loggas.
 * Att INTE hitta något är också ett resultat som måste kunna visas i efterhand.
 */
async function verifyIngenTraff(c: Ava, stamp: string): Promise<void> {
  console.log("\n--- Obesläktad person ---");
  const okand = `Ovidkommande Person ${stamp}`;
  const res = await c.conflict.check.mutate({ searchTerm: okand, searchType: "both" });
  assert(res.matchCount === 0, `${res.matchCount} träffar på en person som inte finns i byrån`);
  console.log("  ✓ 0 träffar — ingen falsk positiv");
}

/**
 * Dokumentationsplikten. Kontrollen ska gå att visa i efterhand: vem som körde
 * den, på vad, och vad den gav. En kontroll som inte kan bevisas är, ur
 * tillsynssynpunkt, ingen kontroll.
 */
async function verifyHistorik(c: Ava, f: Fixture, stamp: string): Promise<void> {
  console.log("\n--- Dokumentationsplikt: historiken ---");
  const hist = await c.conflict.history.query({ page: 1, pageSize: 50 });
  const terms = hist.checks.map((h) => h.searchTerm);

  assert(terms.includes(f.viktor.name), "byråjävs-sökningen saknas i historiken");
  assert(terms.includes(KARIN_PNR), "personnummer-sökningen saknas i historiken");
  assert(terms.some((t) => t.includes(`Ovidkommande Person ${stamp}`)),
    "sökningen UTAN träff loggades inte — även ett negativt resultat ska kunna visas");
  console.log(`  ✓ Alla ${5} kontroller loggade, inklusive den utan träff`);
}

// ─── Körning ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const annaId = await seedUser(ANNA, "Anna Jäv");
  const bertilId = await seedUser(BERTIL, "Bertil Jäv");
  const c = clientFor(ANNA);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log("Jävskontroll-E2E: underlaget enligt VRGA 3.2.1 och 3.5");

  const f = await seed(c, annaId, bertilId, stamp);
  await verifyByrajav(c, f);
  await verifyAvslutatArende(c, f);
  await verifyPersonnummer(c, f);
  await verifyStavning(c, f, stamp);
  await verifyIngenTraff(c, stamp);
  await verifyHistorik(c, f, stamp);

  console.log("\n✓ Jävskontroll-E2E klart: byråjäv, historik, identitet och dokumentation.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Jävskontroll-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
