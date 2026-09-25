/**
 * Fortnox UI-E2E (#1173) — allt i webb-UIt, som en användare gör det:
 *
 *   Inställningar: Fortnox ansluten, kontomappning (CI:s serie + konton)
 *   → nytt ärende med en ny testklient → PRIVAT → aconto-faktura 12 500 kr
 *   → markera skickad → två delbetalningar (5 000 + 7 500) → "Bokför i Fortnox".
 *
 * Förutsättning (tooling/scripts/fortnox-ui-e2e.sh): den fulla self-hosted-
 * stacken är uppe och servern har Fortnox-tokens (CI:s sandbox). Kontrollen
 * av själva verifikaten i Fortnox görs av `fortnox-ui-harness.ts verify`.
 * Datum sätts inom CI:s räkenskapsår så verifikaten går att städa bort.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

interface UiState {
  bookingDate: string;
  voucherSeries: string;
  accounts: { kundfordran: string; intaktArvode: string; momsUtgaende: string; bank: string };
  stamp: string;
}

const state = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "tooling", ".fortnox-ui", "state.json"), "utf8"),
) as UiState;

const MATTER = `Fortnox UI-test ${state.stamp}`;
const CLIENT = `Testklient ${state.stamp}`;
const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;

async function login(page: Page): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE);
  await page.fill("#username", "admin");
  await page.fill("#password", "admin");
  await page.click("#kc-login");
  await page.waitForURL((u) => !AUTHORIZE_RE.test(u.toString()));
}

async function configureLedger(page: Page): Promise<void> {
  await page.goto("/ava/settings/");
  await expect(page.getByText("ansluten ✓")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Verifikatserie").fill(state.voucherSeries);
  const accounts: Array<[RegExp, string]> = [
    [/^Kundfordran.*kontonummer/, state.accounts.kundfordran],
    [/^Intäkt arvode.*kontonummer/, state.accounts.intaktArvode],
    [/^Utgående moms.*kontonummer/, state.accounts.momsUtgaende],
    [/^Bank.*kontonummer/, state.accounts.bank],
  ];
  for (const [label, number] of accounts) await page.getByLabel(label).fill(number);
  await page.getByRole("button", { name: "Spara mappning" }).click();
  await expect(page.getByText("Sparat ✓")).toBeVisible();
}

async function createMatterWithNewClient(page: Page): Promise<void> {
  await page.goto("/ava/matters/");
  await page.getByRole("button", { name: "+ Nytt ärende" }).click();
  await page.getByLabel("Titel *").fill(MATTER);
  await page.getByRole("button", { name: /Välj klient/ }).click();
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill(CLIENT);
  await page.getByRole("button", { name: "+ Ny klient…" }).click();
  await expect(page.getByLabel("Namn *")).toHaveValue(CLIENT);
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText(CLIENT)).toBeVisible();
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await page.getByRole("link", { name: MATTER }).click();
  await expect(page.getByRole("heading", { name: MATTER })).toBeVisible({ timeout: 30_000 });
}

async function setPrivatePayment(page: Page): Promise<void> {
  const card = page.locator("div.bg-white", { has: page.getByText("Betalningssätt", { exact: true }) }).last();
  await card.getByRole("button", { name: "Ändra" }).click();
  await page.getByLabel("Betalningssätt", { exact: true }).selectOption("PRIVAT");
  const editor = page.locator("div", { has: page.getByText("Ändra betalningssätt") }).last();
  await editor.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Skapa faktura" })).toBeVisible({ timeout: 20_000 });
}

async function createAccontoInvoice(page: Page): Promise<void> {
  await page.getByRole("button", { name: "+ Skapa faktura" }).click();
  await page.getByRole("button", { name: "Aconto till klient" }).click();
  await page.getByPlaceholder("Skriv in belopp").fill("12500");
  await page.getByLabel("Fakturadatum").fill(state.bookingDate);
  await page.getByRole("button", { name: "Skapa aconto-faktura" }).click();
  const invoiceLink = page.locator('main a[href*="/invoices/"]').first();
  await expect(invoiceLink).toBeVisible({ timeout: 30_000 });
  await invoiceLink.click();
  await expect(page).toHaveURL(/\/invoices\//, { timeout: 30_000 });
}

async function pay(page: Page, kronor: string): Promise<void> {
  await page.getByRole("button", { name: "Registrera betalning" }).click();
  await page.getByLabel("Belopp (kr)").fill(kronor);
  await page.getByLabel("Betalningsdatum").fill(state.bookingDate);
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByLabel("Belopp (kr)")).toBeHidden();
}

test("ärende → faktura → delbetalningar → bokfört i Fortnox", async ({ page }) => {
  // Synk-/bokföringsloggar till CI-loggen — det är där ett fel syns först.
  page.on("console", (m) => { if (/sync|synk|konflikt|conflict|server-first|fortnox|bokför/i.test(m.text())) console.log(`[browser] ${m.text()}`); });
  await login(page);
  await configureLedger(page);
  await createMatterWithNewClient(page);
  await setPrivatePayment(page);
  await createAccontoInvoice(page);

  await page.getByRole("button", { name: "Markera som skickad" }).click();
  await expect(page.getByRole("button", { name: "Markera som skickad" })).toBeHidden({ timeout: 20_000 });

  await pay(page, "5000");
  await pay(page, "7500");
  await expect(page.getByRole("button", { name: "Registrera betalning" })).toBeHidden({ timeout: 20_000 }); // fullt betald

  await page.getByRole("button", { name: "Bokför i Fortnox" }).click();
  await expect(page.getByText(/Bokförd i Fortnox \(verifikat [A-Z]+\/\d+\) · 2 betalningar bokförda/)).toBeVisible({ timeout: 60_000 });
});
