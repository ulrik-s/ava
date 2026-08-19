/**
 * E2E mot RIKTIGA Fortnox Voucher API (#1030).
 *
 * Till skillnad från enhetstesterna (injicerad `fetch`) går det här hela vägen:
 * OAuth-refresh → bygg semantiskt verifikat → POST /3/vouchers → läs tillbaka
 * verifikatet → verifiera balans och write-back. Det är den enda kontrollen
 * som fångar att wire-formatet fortfarande stämmer med vad Fortnox faktiskt
 * accepterar (jfr `client.ts`: fel nesting ger 400/2002381).
 *
 * ## Körs INTE i PR-matrisen
 *
 * Varje körning bränner ett verifikatnummer som inte går att ta tillbaka, och
 * refresh-token roterar (se nedan). Därför `workflow_dispatch` — manuellt, mot
 * sandbox.
 *
 * ## Roterande refresh-token
 *
 * Fortnox ogiltigförklarar den gamla refresh-token:en vid varje refresh. Ett
 * token i en GitHub-secret räcker alltså till EN körning om inte det nya
 * skrivs tillbaka. Scriptet skriver därför den roterade token:en till
 * `$GITHUB_OUTPUT` (`refresh_token`) så workflow:et kan uppdatera secreten.
 * Token:en skrivs ALDRIG till stdout — GitHub maskerar bara det den känner.
 *
 * Env:
 *   AVA_FORTNOX_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN   (obligatoriska)
 *   AVA_FORTNOX_VOUCHER_SERIES  (default "A")
 *   AVA_FORTNOX_KONTO_*         kontomappning, se DEFAULT_MAPPING
 *   AVA_FORTNOX_DRY_RUN=1       kör allt UTOM POST (rök-test av auth)
 */

import { appendFileSync } from "node:fs";
import { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import { FortnoxLedgerConnector } from "@/lib/server/integrations/fortnox/connector";
import { fortnoxConfigSchema, fortnoxKontoMappningSchema, type FortnoxConfig, type FortnoxKontoMappning } from "@/lib/server/integrations/fortnox/schema";
import { InMemoryFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import { bookUnbookedInvoices, type BookableInvoice } from "@/lib/server/integrations/ledger/book-invoices";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ ${name} saknas. Se docs/fortnox-e2e.md för vilka secrets som krävs.`);
    process.exit(2);
  }
  return v;
}

/** BAS-kontoplanens standardkonton — byrån överstyr via env. */
const DEFAULT_MAPPING = { voucherSeries: "A", kundfordran: "1510", intaktArvode: "3041", momsUtgaende: "2611" };

function buildConfig(): FortnoxConfig {
  return fortnoxConfigSchema.parse({
    clientId: required("AVA_FORTNOX_CLIENT_ID"),
    clientSecret: required("AVA_FORTNOX_CLIENT_SECRET"),
    // Redirect-URI:n används bara i authorize-steget (som redan är gjort) —
    // refresh bryr sig inte om den, men schemat kräver ett giltigt värde.
    redirectUri: process.env.AVA_FORTNOX_REDIRECT_URI ?? "https://localhost/callback",
    scopes: ["bookkeeping"],
  });
}

/** En faktura att bokföra. Byggd i minnet: det som testas är LEDGER-vägen,
 *  inte repo-lagret (det har sina egna tester). Beloppen är avsiktligt små och
 *  udda så raden går att känna igen i sandboxen. */
function testInvoice(stamp: string): BookableInvoice {
  return {
    id: `e2e-${stamp}`,
    amount: 12_500,      // 125,00 kr inkl moms
    vatOre: 2_500,       // 25,00 kr moms
    vatBreakdown: null,
    invoiceDate: new Date().toISOString().slice(0, 10),
    invoiceNumber: `E2E-${stamp}`,
    status: "SENT",
    fortnoxId: null,
    matter: { matterNumber: `E2E-${stamp}` },
  };
}

/** Skriv den roterade refresh-token:en till GITHUB_OUTPUT (aldrig till stdout). */
function emitRotatedToken(token: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  appendFileSync(out, `refresh_token=${token}\n`);
  console.log("• Roterad refresh-token skriven till GITHUB_OUTPUT (maskerad).");
}

/** Kontomappning ur env, med BAS-defaults. Egen funktion: fyra valfria
 *  overrides är fyra grenar, och de hör inte hemma i flödet. */
function buildMapping(): FortnoxKontoMappning {
  const overrides: Record<string, string | undefined> = {
    voucherSeries: process.env.AVA_FORTNOX_VOUCHER_SERIES,
    kundfordran: process.env.AVA_FORTNOX_KONTO_KUNDFORDRAN,
    intaktArvode: process.env.AVA_FORTNOX_KONTO_ARVODE,
    momsUtgaende: process.env.AVA_FORTNOX_KONTO_MOMS,
  };
  const set = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return fortnoxKontoMappningSchema.parse({ ...DEFAULT_MAPPING, ...set });
}

/** Steg 2: bokför testfakturan och verifiera write-back. */
async function pushTestInvoice(connector: FortnoxLedgerConnector, invoice: BookableInvoice): Promise<string> {
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
async function verifyIdempotens(connector: FortnoxLedgerConnector, invoice: BookableInvoice, externalId: string): Promise<void> {
  const second = await bookUnbookedInvoices({
    invoices: [{ ...invoice, fortnoxId: externalId }], connector, markBooked: async () => {},
  });
  if (second.length !== 0) throw new Error("Idempotens bruten — en bokförd faktura bokfördes igen.");
  console.log("  ✓ Idempotens: omkörning skapade inget nytt verifikat");
}

async function main(): Promise<void> {
  const config = buildConfig();
  const mapping = buildMapping();

  // accessToken tomt + utgånget → klienten tvingas refresha direkt, vilket är
  // precis vad vi vill verifiera (och det som roterar token:en).
  const store = new InMemoryFortnoxTokenStore({
    accessToken: "utgången", refreshToken: required("AVA_FORTNOX_REFRESH_TOKEN"), accessTokenExpiresAt: 0,
  });
  const client = new FortnoxClient(config, store);

  console.log("→ Steg 1: OAuth-refresh + anslutningskoll mot Fortnox …");
  await client.checkConnection();
  console.log("  ✓ Ansluten (GET /3/voucherseries → 200)");

  // Token:en roterade i refreshen ovan — ut med den DIREKT, före allt som kan
  // fela. Annars är den nya token:en förlorad och nästa körning kan inte auth:a.
  const rotated = await store.load();
  if (rotated) emitRotatedToken(rotated.refreshToken);

  if (process.env.AVA_FORTNOX_DRY_RUN === "1") {
    console.log("→ DRY_RUN: hoppar över verifikat-push. Auth och anslutning verifierade.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const invoice = testInvoice(stamp);
  const connector = new FortnoxLedgerConnector({ client, mapping });

  const externalId = await pushTestInvoice(connector, invoice);
  await verifyVoucher(client, externalId);
  await verifyIdempotens(connector, invoice, externalId);

  console.log(`\n✓ Fortnox-E2E klart. Verifikat ${externalId} i serie ${mapping.voucherSeries}.`);
}

main().catch((e: unknown) => {
  console.error(`\n✗ Fortnox-E2E misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
