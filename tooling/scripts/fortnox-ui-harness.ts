#!/usr/bin/env bun
/**
 * Fortnox UI-E2E (#1173) — det runt Playwright-spec:en som inte är UI.
 *
 *   prepare  anslut med CI:s refresh-token (samma secret som övriga Fortnox-
 *            jobb), ta en före-bild av verifikaten och skriv tokens till ett
 *            valv som skriptet kopierar in i server-containern. Det motsvarar
 *            "Anslut Fortnox" — consent-rundan kräver en människa och kan inte
 *            köras i CI.
 *   verify   läs tillbaka fakturans och delbetalningarnas verifikat (id:n ur
 *            databasen, dit appen skrev dem) och kontrollera att allt blev rätt:
 *            balans, konton, att kundfordran nettar till noll och att exakt de
 *            verifikaten tillkom.
 *
 * Tokens roterar: båda stegen emittar den senaste refresh-token:en till
 * $GITHUB_OUTPUT så workflowet kan spara den.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import type { FortnoxVoucherFetch } from "@/lib/server/integrations/fortnox/schema";
import { VaultFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import { loadMasterKey } from "@/lib/server/secrets/crypto";
import { EncryptedFileVault, nodeVaultFs } from "@/lib/server/secrets/vault";
import { assert, kr } from "./e2e-harness";
import {
  assertVoucherDelta, bookingWindow, buildConfig, buildMapping, ciBookingDate, connect, emitRotatedToken,
  required, snapshotVouchers,
} from "./fortnox-harness";

const STATE_DIR = join(process.cwd(), "tooling", ".fortnox-ui");
const STATE_FILE = join(STATE_DIR, "state.json");
const VAULT_FILE = join(STATE_DIR, "vault.enc");

/** Det spec:en och verify-steget delar. */
interface UiState {
  bookingDate: string;
  voucherSeries: string;
  /** Kontona spec:en fyller i under Inställningar → Bokföring. */
  accounts: { kundfordran: string; intaktArvode: string; momsUtgaende: string; bank: string };
  yearId: number;
  before: string[];
  stamp: string;
}

function vault(): EncryptedFileVault {
  return new EncryptedFileVault(VAULT_FILE, loadMasterKey(required("AVA_SECRETS_KEY")), nodeVaultFs());
}

const bankAccount = (): string => process.env.AVA_FORTNOX_KONTO_BANK || "1930";

const tokenKey = (): string => `fortnox.tokens.${required("AVA_ORGANIZATION_ID")}`;

async function prepare(): Promise<void> {
  const window = bookingWindow();
  const mapping = buildMapping();
  const { client, store } = connect(buildConfig());
  await client.checkConnection();
  await emitRotatedToken(store); // roterade nyss — spara innan något annat kan fela

  const yearId = await client.financialYearIdFor(window.from, window.to);
  const before = [...await snapshotVouchers(client, yearId)];
  const tokens = await store.load();
  assert(tokens !== null, "inga tokens efter anslutningen");

  mkdirSync(dirname(VAULT_FILE), { recursive: true });
  await new VaultFortnoxTokenStore(vault(), tokenKey()).save(tokens);
  const state: UiState = {
    bookingDate: ciBookingDate(window), voucherSeries: mapping.voucherSeries, yearId, before,
    accounts: { kundfordran: mapping.kundfordran, intaktArvode: mapping.intaktArvode, momsUtgaende: mapping.momsUtgaende, bank: bankAccount() },
    stamp: Date.now().toString(36),
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`✓ Ansluten · serie ${state.voucherSeries} · bokföringsdatum ${state.bookingDate} · ${before.length} verifikat före`);
}

interface Row { account: number; debit: number; credit: number }

const toOre = (sek: number): number => Math.round(sek * 100);

function rowsOf(v: FortnoxVoucherFetch): Row[] {
  return v.Voucher.VoucherRows.map((r) => ({ account: Number(r.Account), debit: toOre(r.Debit), credit: toOre(r.Credit) }));
}

/** Saldo (debet − kredit) på ett konto i ett verifikat. */
function net(rows: readonly Row[], account: string): number {
  return rows.filter((r) => String(r.account) === account).reduce((s, r) => s + r.debit - r.credit, 0);
}

function assertBalanced(id: string, rows: readonly Row[]): void {
  const d = rows.reduce((s, r) => s + r.debit, 0);
  const c = rows.reduce((s, r) => s + r.credit, 0);
  assert(d === c, `${id} balanserar inte: debet ${kr(d)} ≠ kredit ${kr(c)}`);
}

async function fetchRows(client: FortnoxClient, id: string): Promise<Row[]> {
  const [series, number] = id.split("/");
  return rowsOf(await client.getVoucher(series ?? "", number ?? ""));
}

/** Fakturan + dess betalningar som appen bokförde, ur databasen. */
async function bookedFromDb(stamp: string): Promise<{ invoice: { id: string; amount: number; vat: number; fortnoxId: string | null }; payments: Array<{ amount: number; fortnoxId: string | null }> }> {
  const sql = postgres(required("AVA_DATABASE_URL"), { max: 1 });
  try {
    const [inv] = await sql<Array<{ id: string; amount: number; vat_ore: number | null; fortnox_id: string | null }>>`
      SELECT i.id, i.amount, i.vat_ore, i.fortnox_id FROM invoices i JOIN matters m ON m.id = i.matter_id
      WHERE m.title = ${`Fortnox UI-test ${stamp}`} ORDER BY i.created_at DESC LIMIT 1`;
    assert(inv !== undefined, "hittade ingen faktura för testärendet");
    const pays = await sql<Array<{ amount: number; fortnox_id: string | null }>>`
      SELECT amount, fortnox_id FROM payments WHERE invoice_id = ${inv.id} ORDER BY paid_at`;
    return {
      invoice: { id: inv.id, amount: Number(inv.amount), vat: Number(inv.vat_ore ?? 0), fortnoxId: inv.fortnox_id },
      payments: pays.map((p) => ({ amount: Number(p.amount), fortnoxId: p.fortnox_id })),
    };
  } finally {
    await sql.end();
  }
}

async function verify(): Promise<void> {
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as UiState;
  const mapping = buildMapping();
  const bank = bankAccount();
  const store = new VaultFortnoxTokenStore(vault(), tokenKey());
  const client = new FortnoxClient(buildConfig(), store);
  try {
    const { invoice, payments } = await bookedFromDb(state.stamp);
    assert(invoice.fortnoxId !== null, "fakturan saknar verifikat — bokfördes den i UI:t?");
    assert(payments.length >= 2, `väntade minst två delbetalningar, fick ${payments.length}`);
    assert(payments.every((p) => p.fortnoxId !== null), "alla delbetalningar är inte bokförda");
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    assert(paid === invoice.amount, `delbetalningarna ${kr(paid)} ≠ fakturans ${kr(invoice.amount)}`);

    const invRows = await fetchRows(client, invoice.fortnoxId);
    assertBalanced(invoice.fortnoxId, invRows);
    assert(net(invRows, mapping.kundfordran) === invoice.amount, `kundfordran debiterad ${kr(net(invRows, mapping.kundfordran))} ≠ ${kr(invoice.amount)}`);
    assert(-net(invRows, mapping.intaktArvode) === invoice.amount - invoice.vat, "intäkten ≠ nettot");
    assert(-net(invRows, mapping.momsUtgaende) === invoice.vat, "momsen stämmer inte");
    console.log(`  ✓ ${invoice.fortnoxId}: faktura ${kr(invoice.amount)} (moms ${kr(invoice.vat)})`);

    let receivable = net(invRows, mapping.kundfordran);
    const ids = [invoice.fortnoxId];
    for (const p of payments) {
      const id = p.fortnoxId ?? "";
      const rows = await fetchRows(client, id);
      assertBalanced(id, rows);
      assert(net(rows, bank) === p.amount, `${id}: bank (${bank}) debiterad ${kr(net(rows, bank))} ≠ ${kr(p.amount)}`);
      assert(-net(rows, mapping.kundfordran) === p.amount, `${id}: kundfordran krediterad fel`);
      receivable += net(rows, mapping.kundfordran);
      ids.push(id);
      console.log(`  ✓ ${id}: delbetalning ${kr(p.amount)} — bank D / kundfordran K`);
    }
    assert(receivable === 0, `kundfordran nettar inte till noll: ${kr(receivable)} kvar`);
    console.log("  ✓ Kundfordran nettar till 0 efter sista delbetalningen");

    assertVoucherDelta(new Set(state.before), await snapshotVouchers(client, state.yearId), ids);
  } finally {
    await emitRotatedToken(store);
  }
}

const cmd = process.argv[2];
if (cmd === "prepare") await prepare();
else if (cmd === "verify") await verify();
else { console.error("användning: fortnox-ui-harness.ts prepare|verify"); process.exit(2); }
