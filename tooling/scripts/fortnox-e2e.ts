/**
 * E2E mot RIKTIGA Fortnox Voucher API (#1030, #1035).
 *
 * Till skillnad från enhetstesterna (injicerad `fetch`) går det här hela vägen:
 * OAuth-refresh → bygg semantiskt verifikat → POST /3/vouchers → läs tillbaka
 * verifikatet → verifiera balans och write-back. Det är den enda kontrollen
 * som fångar att wire-formatet fortfarande stämmer med vad Fortnox faktiskt
 * accepterar (jfr `client.ts`: fel nesting ger 400/2002381).
 *
 * ## Var verifikaten hamnar
 *
 * I CI:s EGNA verifikatserie och CI:s EGNA räkenskapsår. Fortnox API kan inte
 * ta bort verifikat, men i GUI:t går det alltid att ta bort det sista
 * verifikatet i en serie — och ett räkenskapsår som bara innehåller manuella
 * verifikat kan raderas i sin helhet. Båda villkoren är uppfyllda här, vilket
 * är det som gör det försvarbart att köra i det ordinarie flödet.
 *
 * Spärren som håller det sant är `AVA_FORTNOX_BOOKING_WINDOW`: connectorn
 * lindas i `withBookingWindow`, och ett verifikat med datum utanför CI-året
 * avvisas innan det når nätet. Saknas variabeln kastar skriptet.
 *
 * ## Roterande refresh-token
 *
 * Fortnox ogiltigförklarar den gamla refresh-token:en vid varje refresh. Ett
 * token i en GitHub-secret räcker alltså till EN körning om inte det nya
 * skrivs tillbaka. Scriptet skriver därför den roterade token:en till
 * `$GITHUB_OUTPUT` (`refresh_token`) så workflow:et kan uppdatera secreten.
 * Token:en skrivs ALDRIG till stdout — GitHub maskerar bara det den känner.
 *
 * Env: se `fortnox-harness.ts`. `AVA_FORTNOX_DRY_RUN=1` kör allt UTOM POST.
 */

import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import { FortnoxLedgerConnector } from "@/lib/server/integrations/fortnox/connector";
import { bookUnbookedInvoices, type BookableInvoice } from "@/lib/server/integrations/ledger/book-invoices";
import { withBookingWindow, type BookingWindow } from "@/lib/server/integrations/ledger/booking-window";
import type { LedgerConnector } from "@/lib/server/integrations/ledger/port";
import {
  bookingWindow, buildConfig, buildMapping, ciBookingDate, connect, emitRotatedToken,
} from "./fortnox-harness";

/** En faktura att bokföra. Byggd i minnet: det som testas är LEDGER-vägen,
 *  inte repo-lagret (det har sina egna tester). Beloppen är avsiktligt små och
 *  udda så raden går att känna igen i sandboxen. Datumet ligger i CI-året. */
function testInvoice(stamp: string, bookingDate: string): BookableInvoice {
  return {
    id: `e2e-${stamp}`,
    amount: 12_500,      // 125,00 kr inkl moms
    vatOre: 2_500,       // 25,00 kr moms
    vatBreakdown: null,
    invoiceDate: bookingDate,
    invoiceNumber: `E2E-${stamp}`,
    status: "SENT",
    fortnoxId: null,
    matter: { matterNumber: `E2E-${stamp}` },
  };
}

/** Steg 2: bokför testfakturan och verifiera write-back. */
async function pushTestInvoice(connector: LedgerConnector, invoice: BookableInvoice): Promise<string> {
  console.log(`→ Steg 2: bokför testfaktura ${invoice.invoiceNumber} (125,00 kr inkl moms) …`);
  const marked: Array<[string, string]> = [];
  const [outcome] = await bookUnbookedInvoices({
    invoices: [invoice], connector,
    markBooked: async (id, ext) => { marked.push([id, ext]); },
  });
  if (!outcome || outcome.error || !outcome.externalId) {
    throw new Error(`Bokföring misslyckades: ${outcome?.error ?? "inget utfall"}`);
  }
  console.log(`  ✓ Verifikat skapat: ${outcome.externalId}`);
  if (marked.length !== 1) throw new Error(`Write-back uteblev — markBooked anropades ${marked.length} gånger.`);
  console.log(`  ✓ fortnoxId skrevs tillbaka: ${marked[0]![1]}`);
  return outcome.externalId;
}

/** Steg 3: läs tillbaka verifikatet och kontrollera att det balanserar. */
async function verifyVoucher(client: FortnoxClient, externalId: string): Promise<void> {
  console.log("→ Steg 3: läser tillbaka verifikatet ur Fortnox …");
  const [series, number] = externalId.split("/");
  const back = await client.getVoucher(series ?? "", number ?? "");
  const rows = back.Voucher.VoucherRows;
  const debit = rows.reduce((sum, r) => sum + r.Debit, 0);
  const credit = rows.reduce((sum, r) => sum + r.Credit, 0);
  if (Math.abs(debit - credit) > 0.001) {
    throw new Error(`Verifikatet balanserar inte: debet ${debit} ≠ kredit ${credit}`);
  }
  console.log(`  ✓ ${rows.length} rader, debet ${debit} = kredit ${credit}`);
}

/** Steg 4: samma faktura MED externt id får inte bokföras igen. */
async function verifyIdempotens(connector: LedgerConnector, invoice: BookableInvoice, externalId: string): Promise<void> {
  const second = await bookUnbookedInvoices({
    invoices: [{ ...invoice, fortnoxId: externalId }], connector, markBooked: async () => {},
  });
  if (second.length !== 0) throw new Error("Idempotens bruten — en bokförd faktura bokfördes igen.");
  console.log("  ✓ Idempotens: omkörning skapade inget nytt verifikat");
}

/** Steg 5: spärren måste faktiskt spärra. Ett verifikat daterat utanför
 *  fönstret ska avvisas LOKALT — utan att något skickas till Fortnox. */
async function verifyWindowGuard(connector: LedgerConnector, invoice: BookableInvoice, period: BookingWindow): Promise<void> {
  const outside = `${Number(period.from.slice(0, 4)) - 1}${period.from.slice(4)}`;
  const [outcome] = await bookUnbookedInvoices({
    invoices: [{ ...invoice, id: `${invoice.id}-utanfor`, invoiceDate: outside }],
    connector, markBooked: async () => {},
  });
  if (!outcome?.error) throw new Error(`Spärren släppte igenom ett verifikat daterat ${outside}.`);
  console.log(`  ✓ Spärr: ${outside} avvisades (${outcome.error.slice(0, 60)}…)`);
}

async function main(): Promise<void> {
  const config = buildConfig();
  const mapping = buildMapping();
  const period = bookingWindow();
  const { client, store } = connect(config);

  console.log(`→ Steg 1: OAuth-refresh + anslutningskoll mot Fortnox (fönster ${period.from}..${period.to}) …`);
  await client.checkConnection();
  console.log("  ✓ Ansluten (GET /3/voucherseries → 200)");

  // Token:en roterade i refreshen ovan — ut med den DIREKT, före allt som kan
  // fela. Annars är den nya token:en förlorad och nästa körning kan inte auth:a.
  await emitRotatedToken(store);

  if (process.env.AVA_FORTNOX_DRY_RUN === "1") {
    console.log("→ DRY_RUN: hoppar över verifikat-push. Auth och anslutning verifierade.");
    return;
  }

  const bookingDate = ciBookingDate(period);
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const invoice = testInvoice(stamp, bookingDate);
  const connector = withBookingWindow(new FortnoxLedgerConnector({ client, mapping }), period);

  const externalId = await pushTestInvoice(connector, invoice);
  await verifyVoucher(client, externalId);
  await verifyIdempotens(connector, invoice, externalId);
  await verifyWindowGuard(connector, invoice, period);

  console.log(`\n✓ Fortnox-E2E klart. Verifikat ${externalId} i serie ${mapping.voucherSeries}, daterat ${bookingDate}.`);
}

main().catch((e: unknown) => {
  console.error(`\n✗ Fortnox-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
