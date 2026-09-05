#!/usr/bin/env bun
/**
 * CAMT-BETALNINGS-E2E (#1067) — bankfil → parser → matchning → bokförd betalning.
 *
 * ## Luckan som stängs
 *
 * `camt-parse.ts` är testad mot riktiga SEB-filer, och matcharna är testade
 * mot fixturer. Men INGEN kontroll har kört hela kedjan: de riktiga filerna har
 * fasta referenser och kan aldrig matcha en faktura ett test just skapat, så
 * e2e:erna har byggt camt-TRANSAKTIONER i minnet och matat matcharen direkt.
 *
 * Det hoppar över XML-steget — och det är där en bankfil spretar. Går parsern
 * sönder eller driver formatet märker ingen det förrän en byrå importerar en
 * fil som inte bokförs, tyst.
 *
 * Här genereras filen (`camt-builder.ts`, modellerad element för element på
 * SEB:s Test Bench-fil), parsas med den SKARPA parsern, matchas med de SKARPA
 * matcharna och bokförs via det riktiga API:t.
 *
 * ## Två referensvägar, båda med pengar i sig
 *
 *   OCR (strukturerad)  klientens fakturabetalning → invoice.recordPayment
 *   Fri text            domstolens utbetalning     → expectedReceivable.settle
 *
 * ## Och omimporten
 *
 * Banken skickar om filer, och en människa importerar samma fil två gånger.
 * Sista steget kör därför exakt samma XML igen och kräver att INGENTING bokförs
 * en andra gång. En dubbelbokförd inbetalning ser ut som en överbetalning och
 * leder till att pengar betalas tillbaka som aldrig kommit in.
 *
 *   bun run e2e:camt-payment
 */

import { Window } from "happy-dom";
import { parseCamtXml } from "@/lib/shared/payments/camt-parse";
import { matchTransactions, type InvoiceCandidate } from "@/lib/shared/payments/match-payments";
import { matchReceivables, type ReceivableCandidate } from "@/lib/shared/payments/match-receivables";
import { asId } from "@/lib/shared/schemas/ids";
import { buildCamt054, type CamtTx } from "./camt-builder";
import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";

/**
 * camt-parsern använder browser-nativ `DOMParser`, och det är INTE en
 * eftergift för testet: importen sker i webbläsaren i AVA (importsidan parsar
 * klient-sida). Bun saknar DOMParser, så vi lånar happy-doms.
 *
 * ENBART `DOMParser` sätts — inte hela browsermiljön. `GlobalRegistrator`
 * ersätter också `fetch`, och då slutar tRPC-klienten nå servern: första
 * försöket föll på "server-first svarade inte inom 30s", inte på något
 * camt-relaterat alls.
 */
const { DOMParser } = new Window();
Object.assign(globalThis, { DOMParser });

const USER = "anna-camt@byra.se";
const RATE_ORE = 250_000;
const BOOKING_DATE = "2026-06-15";
const COURT_CASE = "4411-26";
/** Domstolen prutar; utbetalningen är sällan det begärda. */
const BEGART_ORE = 2_032_500;
const UTBETALT_ORE = 1_626_000;

// ─── Uppsättning ───────────────────────────────────────────────────────────

interface Fixture {
  invoiceId: string;
  ocr: string;
  invoiceAmount: number;
  receivableId: string;
  matterNumber: string;
}

/** Klientfaktura med OCR + domstolsfordran med målnummer — en per referensväg. */
async function seed(c: Ava, userId: string, stamp: string): Promise<Fixture> {
  console.log("\n--- Bygger upp en fakturerad klient och en domstolsfordran ---");

  const klient = await c.contacts.create.mutate({
    name: `Camt-klient ${stamp}`, contactType: "PERSON", email: `camt-${stamp}@klient.test`,
  });
  const m = await c.matter.create.mutate({
    matterNumber: `CAMT-${stamp}`, title: `Camt-ärende ${stamp}`,
    matterType: "Brottmål", paymentMethod: "PRIVAT", responsibleLawyerId: userId,
    courtCaseNumber: COURT_CASE,
  });
  await c.matter.addContact.mutate({ matterId: m.id, contactId: klient.id, role: "KLIENT" });
  await c.timeEntry.create.mutate({
    matterId: m.id, userId, date: "2026-05-02", minutes: 300,
    description: "Handläggning", billable: true, hourlyRate: RATE_ORE,
  });

  const { invoice } = await c.billingRun.createFinal.mutate({
    matterId: m.id, recipient: "KLIENT", invoiceDate: "2026-05-20", dueDate: "2026-06-20",
  });
  await c.invoice.setStatus.mutate({ invoiceId: invoice.id, status: "SENT" });
  const full = await c.invoice.getById.query({ id: invoice.id });
  const ocr = full.ocrReference ?? "";
  assert(ocr.length > 0, "fakturan saknar OCR — utan den finns ingen strukturerad referensväg");

  const receivable = await c.expectedReceivable.create.mutate({
    matterId: m.id, description: "Kostnadsräkning till tingsrätten", expectedAmount: BEGART_ORE,
  });

  console.log(`  Faktura ${full.invoiceNumber} · OCR ${ocr} · ${kr(invoice.amount)}`);
  console.log(`  Fordran på domstolen ${kr(BEGART_ORE)}, målnr ${COURT_CASE}`);
  return {
    invoiceId: String(invoice.id), ocr, invoiceAmount: invoice.amount,
    receivableId: String(receivable.id), matterNumber: m.matterNumber,
  };
}

/** Bankfilen: en OCR-betalning från klienten, en fri-text-utbetalning från domstolen. */
function bankFile(f: Fixture): string {
  const txs: CamtTx[] = [
    {
      reference: "AVA-E2E-OCR-1", amountOre: f.invoiceAmount, debtorName: `Camt-klient`,
      structuredRefs: [{ ref: f.ocr, amountOre: f.invoiceAmount }],
    },
    {
      reference: "AVA-E2E-FRITEXT-1", amountOre: UTBETALT_ORE, debtorName: "DOMSTOLSVERKET",
      freeTexts: [`${f.matterNumber} ${COURT_CASE} ENOKSSON`],
    },
  ];
  return buildCamt054(txs, { bookingDate: BOOKING_DATE });
}

// ─── Kedjan ────────────────────────────────────────────────────────────────

/** Steg 1: XML → transaktioner, med den skarpa parsern. */
function parseBankFile(xml: string): ReturnType<typeof parseCamtXml> {
  console.log("\n--- Steg 1: parsa bankfilen ---");
  const file = parseCamtXml(xml);
  assert(file.transactions.length === 2, `parsern hittade ${file.transactions.length} transaktioner, inte 2`);
  const total = file.transactions.reduce((s, t) => s + t.amountOre, 0);
  console.log(`  ✓ 2 transaktioner, ${kr(total)} totalt`);
  return file;
}

interface Matched { invoicePayment: { amountOre: number; reference: string }; receivable: { amountOre: number; reference: string } }

/**
 * Steg 2: matcha. Kandidaterna hämtas från det RIKTIGA API:t och matas
 * oförändrade in i matcharna — det är sömmen som annars aldrig prövas.
 */
async function matchAll(c: Ava, f: Fixture, file: ReturnType<typeof parseCamtXml>): Promise<Matched> {
  console.log("\n--- Steg 2: matcha mot fakturor och fordringar ---");

  const invoices = await c.invoice.list.query({ pageSize: 200 });
  const invoiceCands: InvoiceCandidate[] = invoices.items.map((r) => ({
    id: asId<"InvoiceId">(String(r.id)),
    invoiceNumber: r.invoiceNumber ?? null,
    ocrReference: r.ocrReference ?? null,
    amount: r.amount,
    paymentReferences: (r.payments ?? []).map((p) => p.reference).filter((x): x is string => Boolean(x)),
  }));
  const { bookable } = matchTransactions(file.transactions, invoiceCands);
  const hit = bookable.find((b) => String(b.invoiceId) === f.invoiceId);
  assert(hit !== undefined, "OCR-betalningen matchade inte fakturan");
  assert(hit.matchedBy === "ocr", `matchades via ${hit.matchedBy}, inte ocr — OCR-vägen är den starkaste nyckeln`);
  assert(hit.amountOre === f.invoiceAmount, `förslaget avser ${kr(hit.amountOre)} ≠ ${kr(f.invoiceAmount)}`);
  console.log(`  ✓ OCR ${f.ocr} → faktura, ${kr(hit.amountOre)}`);

  const raw = await c.expectedReceivable.candidates.query();
  const recCands: ReceivableCandidate[] = raw.map((x) => ({
    id: asId<"ExpectedReceivableId">(x.id), matterNumber: x.matterNumber,
    courtCaseNumber: x.courtCaseNumber, expectedAmount: x.expectedAmount, settledReferences: [],
  }));
  const { suggestions } = matchReceivables(file.transactions, recCands);
  const rec = suggestions.find((s) => String(s.receivableId) === f.receivableId);
  assert(rec !== undefined, "fri-text-betalningen matchade inte domstolsfordran");
  assert(rec.amountOre === UTBETALT_ORE, `förslaget avser ${kr(rec.amountOre)} ≠ ${kr(UTBETALT_ORE)}`);
  console.log(`  ✓ Fri text "${f.matterNumber} ${COURT_CASE} …" → fordran, ${kr(rec.amountOre)}`);

  return {
    invoicePayment: { amountOre: hit.amountOre, reference: hit.reference },
    receivable: { amountOre: rec.amountOre, reference: rec.reference },
  };
}

/** Steg 3: bokför båda via det riktiga API:t och kontrollera utfallet. */
async function book(c: Ava, f: Fixture, m: Matched): Promise<void> {
  console.log("\n--- Steg 3: bokför betalningarna ---");

  const res = await c.invoice.recordPayment.mutate({
    invoiceId: f.invoiceId, amount: m.invoicePayment.amountOre,
    paidAt: `${BOOKING_DATE}T12:00:00.000Z`, reference: m.invoicePayment.reference,
    note: "Camt-import",
  });
  assert(res.settled, "fakturan slutreglerades inte trots full betalning");
  const inv = await c.invoice.getById.query({ id: f.invoiceId });
  assert(inv.status === "PAID", `faktura ${inv.status} ≠ PAID`);
  console.log(`  ✓ Faktura betald ur bankfilen → ${inv.status}`);

  const settled = await c.expectedReceivable.settle.mutate({
    id: asId<"ExpectedReceivableId">(f.receivableId), settledAmount: m.receivable.amountOre,
    settledAt: `${BOOKING_DATE}T12:00:00.000Z`, paymentReference: m.receivable.reference,
  });
  assert(settled.status === "SETTLED", `fordran ${settled.status} ≠ SETTLED`);
  assert(settled.expectedAmount === BEGART_ORE, "det begärda beloppet skrevs över av utfallet");
  console.log(`  ✓ Domstolsfordran avprickad: begärt ${kr(BEGART_ORE)}, utbetalt ${kr(UTBETALT_ORE)}`);
}

/**
 * Steg 4: importera EXAKT samma fil igen. Banken skickar om filer och
 * människor dubbelklickar. Bokförs betalningen två gånger ser det ut som en
 * överbetalning, och byrån betalar tillbaka pengar som aldrig kommit in.
 */
async function verifyReimport(c: Ava, f: Fixture, xml: string): Promise<void> {
  console.log("\n--- Steg 4: omimport av samma fil ---");
  const file = parseCamtXml(xml);

  const invoices = await c.invoice.list.query({ pageSize: 200 });
  const cands: InvoiceCandidate[] = invoices.items.map((r) => ({
    id: asId<"InvoiceId">(String(r.id)),
    invoiceNumber: r.invoiceNumber ?? null,
    ocrReference: r.ocrReference ?? null,
    amount: r.amount,
    paymentReferences: (r.payments ?? []).map((p) => p.reference).filter((x): x is string => Boolean(x)),
  }));
  const { bookable, unmatched } = matchTransactions(file.transactions, cands);
  assert(!bookable.some((b) => String(b.invoiceId) === f.invoiceId),
    "fakturan föreslogs för betalning IGEN — samma inbetalning skulle bokföras två gånger");
  assert(unmatched.some((u) => u.reason === "dubblett"),
    `omimporten flaggade inte transaktionen som dubblett (${unmatched.map((u) => u.reason).join(", ")})`);
  console.log("  ✓ Fakturabetalningen känns igen som dubblett på betalningsreferensen");

  const raw = await c.expectedReceivable.candidates.query();
  assert(!raw.some((x) => x.id === f.receivableId),
    "den avprickade fordran ligger kvar bland kandidaterna");
  console.log("  ✓ Domstolsfordran är ur kandidatlistan — kan inte prickas av igen");
}

// ─── Körning ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Anna Camt");
  const c = clientFor(USER);
  await waitForServer(c);
  const stamp = Date.now().toString(36);
  console.log("Camt-betalnings-E2E: bankfil → parser → matchning → bokförd betalning");

  const f = await seed(c, userId, stamp);
  const xml = bankFile(f);
  console.log(`\n  Genererad camt.054: ${xml.length} tecken, 2 kontohändelser`);

  const file = parseBankFile(xml);
  const matched = await matchAll(c, f, file);
  await book(c, f, matched);
  await verifyReimport(c, f, xml);

  console.log("\n✓ Camt-betalnings-E2E klart: båda referensvägarna bokförda, omimport avvisad.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Camt-betalnings-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
