#!/usr/bin/env bun
/**
 * Fortnox BOKFÖRINGS-E2E (#1030) — bokför scenariernas fakturor mot riktiga
 * Voucher API och läser tillbaka verifikaten för att kontrollera att de blev
 * RÄTT, inte bara att de blev skapade.
 *
 * `fortnox-e2e.ts` bevisar att anslutningen och wire-formatet lever, med en
 * syntetisk faktura. Det här kör byråns verkliga fall: täckningsärenden där
 * KLIENTEN och MYNDIGHETEN/FÖRSÄKRINGSBOLAGET betalar var sin del. Två
 * fakturor per ärende → två verifikat, och båda ska bokföras korrekt var för
 * sig.
 *
 * Vad "korrekt" betyder här, kontrollerat per verifikat:
 *   - Σdebet = Σkredit (ett obalanserat verifikat är ingen bokföring)
 *   - kundfordran DEBITERAS med fakturans bruttobelopp
 *   - intäktskontot KREDITERAS med nettot
 *   - momskontot KREDITERAS med momsen
 *   - summan av kreditsidan = bruttot, dvs. inget belopp har fallit bort
 *
 * ## Var verifikaten hamnar
 *
 * I CI:s egna verifikatserie och räkenskapsår, spärrat av
 * `AVA_FORTNOX_BOOKING_WINDOW` (#1035): fakturorna dateras om till CI-året
 * innan de bokförs, och `withBookingWindow` avvisar allt utanför fönstret
 * innan det når nätet. Det gör verifikaten städbara — Fortnox GUI tar bort
 * det sista verifikatet i en serie, och ett räkenskapsår med bara manuella
 * verifikat kan raderas i sin helhet.
 *
 * Antalet ärenden hålls ändå nere: varje faktura bränner ett verifikatnummer.
 *
 * Kräver samma env som `fortnox-e2e.ts` + en körande server-first-stack.
 */

import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import { FortnoxLedgerConnector } from "@/lib/server/integrations/fortnox/connector";
import type { FortnoxKontoMappning } from "@/lib/server/integrations/fortnox/schema";
import { bookUnbookedInvoices, type BookableInvoice } from "@/lib/server/integrations/ledger/book-invoices";
import { withBookingWindow } from "@/lib/server/integrations/ledger/booking-window";
import type { LedgerConnector } from "@/lib/server/integrations/ledger/port";
import { runCoverageScenario, SCENARIOS } from "./billing-scenarios-e2e";
import {
  assert, clientFor, kr, seedUser, waitForServer, type Ava,
} from "./e2e-harness";
import {
  bookingWindow, buildConfig, buildMapping, ciBookingDate, connect, emitRotatedToken,
} from "./fortnox-harness";

const USER = "anna-bookkeeping@byra.se";
/** Bara ETT scenario per körning: varje faktura bränner ett verifikatnummer. */
const SCENARIO = SCENARIOS[1]; // familjemål/rättsskydd — två betalande, ingen KR

/**
 * Fakturan i den form drivrutinen vill ha den, OMDATERAD till CI-året.
 *
 * AVA daterar fakturan till i dag; verifikatet måste ligga i CI:s
 * räkenskapsår för att alls kunna städas bort efteråt. Bokföringsdatum och
 * fakturadatum särar alltså här — medvetet, och bara i testharnessen.
 */
function toBookable(inv: {
  id: string; amount: number; vatOre?: number | null;
  invoiceNumber?: string | null; status: string; matter?: { matterNumber?: string | null } | null;
}, bookingDate: string): BookableInvoice {
  return {
    id: inv.id, amount: inv.amount, vatOre: inv.vatOre ?? null, vatBreakdown: null,
    invoiceDate: bookingDate, invoiceNumber: inv.invoiceNumber ?? null,
    status: inv.status, fortnoxId: null,
    matter: { matterNumber: inv.matter?.matterNumber ?? null },
  };
}

/** Kronor (Fortnox) → öre (domänen). Fortnox räknar i SEK med decimaler. */
const toOre = (sek: number): number => Math.round(sek * 100);

/**
 * Läs tillbaka verifikatet och kontrollera att det bokför fakturan RÄTT.
 * Det räcker inte att Fortnox svarade 200 på skrivningen — frågan är om
 * beloppen hamnade på rätt konton och om något föll bort på vägen.
 */
async function verifyVoucher(
  client: FortnoxClient, mapping: FortnoxKontoMappning, externalId: string, inv: BookableInvoice,
): Promise<void> {
  const [series, number] = externalId.split("/");
  const back = await client.getVoucher(series ?? "", number ?? "");
  const rows = back.Voucher.VoucherRows;

  const debit = rows.reduce((s, r) => s + r.Debit, 0);
  const credit = rows.reduce((s, r) => s + r.Credit, 0);
  assert(Math.abs(debit - credit) < 0.005, `${externalId} balanserar inte: debet ${debit} ≠ kredit ${credit}`);

  const net = inv.amount - (inv.vatOre ?? 0);
  const on = (konto: string): { debit: number; credit: number } => {
    const rs = rows.filter((r) => String(r.Account) === konto);
    return { debit: toOre(rs.reduce((s, r) => s + r.Debit, 0)), credit: toOre(rs.reduce((s, r) => s + r.Credit, 0)) };
  };

  const kundfordran = on(mapping.kundfordran);
  assert(Math.abs(kundfordran.debit - inv.amount) <= 2,
    `kundfordran (${mapping.kundfordran}) debiterad ${kr(kundfordran.debit)} ≠ fakturans ${kr(inv.amount)}`);

  const intakt = on(mapping.intaktArvode);
  assert(Math.abs(intakt.credit - net) <= 2,
    `intäkt (${mapping.intaktArvode}) krediterad ${kr(intakt.credit)} ≠ nettot ${kr(net)}`);

  const moms = on(mapping.momsUtgaende);
  assert(Math.abs(moms.credit - (inv.vatOre ?? 0)) <= 2,
    `moms (${mapping.momsUtgaende}) krediterad ${kr(moms.credit)} ≠ ${kr(inv.vatOre ?? 0)}`);

  // Inget belopp får ha fallit bort mellan konton: kreditsidan = bruttot.
  assert(Math.abs(toOre(credit) - inv.amount) <= 2,
    `kreditsidan ${kr(toOre(credit))} ≠ fakturans brutto ${kr(inv.amount)}`);

  console.log(`    ✓ ${externalId}: kundfordran ${kr(kundfordran.debit)} D · intäkt ${kr(intakt.credit)} K · moms ${kr(moms.credit)} K`);
}

/** Allt bokföringen behöver, samlat — sex lösa parametrar är fler än taket
 *  (och svårare att läsa på anropsplatsen). */
interface BookingCtx {
  ava: Ava;
  client: FortnoxClient;
  connector: LedgerConnector;
  mapping: FortnoxKontoMappning;
  /** Datum inne i CI:s bokföringsfönster — verifikatets transaktionsdatum. */
  bookingDate: string;
}

/** Bokför EN faktura och verifiera dess verifikat. */
async function bookAndVerify(ctx: BookingCtx, invoiceId: string, label: string): Promise<void> {
  const { ava: c, client, connector, mapping, bookingDate } = ctx;
  const raw = await c.invoice.getById.query({ id: invoiceId });
  const inv = toBookable(raw as Parameters<typeof toBookable>[0], bookingDate);
  console.log(`  ${label}: ${inv.invoiceNumber} · ${kr(inv.amount)} (moms ${kr(inv.vatOre ?? 0)})`);

  const marked: Array<[string, string]> = [];
  const [outcome] = await bookUnbookedInvoices({
    invoices: [inv], connector, markBooked: async (id, ext) => { marked.push([id, ext]); },
  });
  if (!outcome || outcome.error || !outcome.externalId) {
    throw new Error(`bokföring av ${label} misslyckades: ${outcome?.error ?? "inget utfall"}`);
  }
  assert(marked.length === 1, `write-back uteblev för ${label}`);
  await verifyVoucher(client, mapping, outcome.externalId, inv);

  // Skriv tillbaka i AVA också — annars bokförs fakturan igen nästa körning.
  await c.invoice.markFortnoxBooked.mutate({ invoiceId, fortnoxId: outcome.externalId });
}

async function main(): Promise<void> {
  if (SCENARIO === undefined) throw new Error("scenariolistan är tom");
  const mapping = buildMapping();
  const period = bookingWindow();
  const bookingDate = ciBookingDate(period);
  const { client, store } = connect(buildConfig());
  const connector = withBookingWindow(new FortnoxLedgerConnector({ client, mapping }), period);

  console.log("→ Steg 1: anslutningskoll mot Fortnox …");
  await client.checkConnection();
  console.log(`  ✓ Ansluten · serie ${mapping.voucherSeries}, konton ${mapping.kundfordran}/${mapping.intaktArvode}/${mapping.momsUtgaende}`);
  console.log(`  ✓ Bokföringsfönster ${period.from}..${period.to} — verifikaten dateras ${bookingDate}`);

  // Token:en roterade i anropet ovan; utan write-back kan nästa körning inte auth:a.
  await emitRotatedToken(store);

  const userId = await seedUser(USER, "Anna Bookkeeping");
  const c = clientFor(USER);
  await waitForServer(c);

  console.log(`\n→ Steg 2: kör scenariot "${SCENARIO.title}" (två betalande) …`);
  const stamp = Date.now().toString(36);
  const clientInvoiceId = await runCoverageScenario(c, userId, SCENARIO, stamp);

  // Betalarfakturan hittas via ärendet — settleCoverage skapade båda.
  const inv = await c.invoice.getById.query({ id: clientInvoiceId });
  const all = await c.invoice.list.query({ matterId: String(inv.matterId), pageSize: 50 });
  const payer = all.items.find((i) => i.id !== clientInvoiceId && i.invoiceType === "FINAL");
  assert(payer !== undefined, "hittade ingen betalarfaktura på ärendet");

  console.log("\n→ Steg 3: bokför BÅDA fakturorna mot Fortnox …");
  const ctx: BookingCtx = { ava: c, client, connector, mapping, bookingDate };
  await bookAndVerify(ctx, clientInvoiceId, "Klientens självrisk");
  await bookAndVerify(ctx, String(payer?.id), "Försäkringsbolagets del");

  console.log("\n✓ Bokförings-E2E klart: båda betalarnas fakturor bokförda och verifierade i Fortnox.");
}

main().catch((e: unknown) => {
  console.error(`\n✗ Bokförings-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
