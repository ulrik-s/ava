/**
 * E2E (#1221, #1735): en skapad men oskickad faktura står i ärendets flik
 * Fakturering, inte i Frister. Frister har bara tidsfrister och "Bör
 * faktureras" — inga faktureringssteg och inget filter för dem.
 *
 * Bör faktureras öppnar ärendets Fakturering direkt (#1854): dialogen Aconto
 * till klient i rättshjälp, annars menyn + Skapa faktura.
 */

import type { Page } from "@playwright/test";
import { DEMO_BASE_URL, fetchDemoSeed, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("oskickad faktura: i ärendets Fakturering, inte i Frister", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const unsent = seed.invoices.find((i) => i.status === "DRAFT" && i.invoiceNumber);
  if (!unsent?.invoiceNumber) throw new Error("seeden saknar en skapad men oskickad faktura (DRAFT) med nummer");

  await page.goto(`${base}/watchlist/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Frister" })).toBeVisible({ timeout: 25_000 });
  // Hela byrån — demoanvändaren är inte ansvarig för alla ärenden.
  await page.getByLabel("Bara mina ärenden").uncheck();
  await expect(page.getByRole("button", { name: "Ofakturerat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fakturering" })).toHaveCount(0);
  await expect(page.getByText(/Skicka faktura/)).toHaveCount(0);

  await page.goto(`${base}/matters/${unsent.matterId}/`, { waitUntil: "load" });
  await showPanel(page, "Fakturering");
  await expect(page.getByText(unsent.invoiceNumber, { exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("region", { name: "Frister" }).getByText(/Skicka faktura/)).toHaveCount(0);
});

/** Svensk dag `days` dagar bakåt, "YYYY-MM-DD" (äldre än 60 dagar → Bör faktureras). */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Nytt ärende med betalningssättet `method` och en tidspost 90 dagar bakåt, så
 * att Bör faktureras visas. Seeden har inget rättshjälpsärende kvar i fasen
 * ARBETE, så testet skapar sina egna (seeden ändras inte). Ger ärendenumret.
 */
async function matterWithOldTime(page: Page, base: string, method: string): Promise<string> {
  const title = `Fakturera nu e2e ${method} ${Date.now()}`;
  await page.goto(`${base}/matters/?new=1`, { waitUntil: "load" });
  await page.getByLabel("Titel *").fill(title);
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);
  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();

  const header = page.getByTestId("matter-header");
  await header.getByRole("button", { name: "Ändra ärende" }).click({ timeout: 25_000 });
  const edit = page.getByRole("dialog", { name: "Ändra ärende" });
  await edit.getByLabel("Betalningssätt").selectOption(method);
  await edit.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(edit).toBeHidden();

  const tid = page.getByRole("region", { name: "Tid" }).last();
  await tid.getByRole("button", { name: /Registrera tid/ }).click();
  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  await dialog.getByLabel("Datum *").fill(daysAgo(90));
  await dialog.getByLabel("Beskrivning *").fill("E2E: gammalt arbete (#1854)");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0);
  const number = await header.locator("h1 span").first().textContent();
  if (!number) throw new Error("ärendehuvudet saknar ärendenummer");
  return number.trim();
}

/** Klickar Bör faktureras för ärendet på sidan Frister. */
async function clickBillNow(page: Page, base: string, matterNumber: string): Promise<void> {
  await page.goto(`${base}/watchlist/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Frister" })).toBeVisible({ timeout: 25_000 });
  await page.getByLabel("Bara mina ärenden").uncheck();
  await page.getByRole("link").filter({ hasText: "Bör faktureras" }).filter({ hasText: matterNumber }).click();
}

test("Bör faktureras öppnar faktureringen direkt (#1854)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);

  // Rättshjälp i fasen ARBETE: dialogen Aconto till klient öppnas direkt.
  const legalAid = await matterWithOldTime(page, base, "RATTSHJALP");
  await clickBillNow(page, base, legalAid);
  await expect(page.getByRole("dialog", { name: "Aconto till klient" })).toBeVisible({ timeout: 25_000 });
  // Parametern är borta ur adressen: en omladdning öppnar inte dialogen igen.
  await expect(page).not.toHaveURL(/fakturera=/);
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("matter-header")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("dialog", { name: "Aconto till klient" })).toHaveCount(0);

  // Privat: menyn + Skapa faktura öppnas.
  const privat = await matterWithOldTime(page, base, "PRIVAT");
  await clickBillNow(page, base, privat);
  await expect(page.getByRole("button", { name: "Faktura till klient" })).toBeVisible({ timeout: 25_000 });
  await expect(page).not.toHaveURL(/fakturera=/);
});

// ── #1912: byråns trösklar i Inställningar → Frister ───────────────────────
// Demon sparar bara i minnet, så testet byter sida med menyn (klientnavigering),
// aldrig med en omladdning.

/** Inställningar → Frister: sätt beloppet (kr) och åldern (dagar) och spara. */
async function setThresholds(page: Page, kr: string, days: string): Promise<void> {
  await page.getByRole("link", { name: /Inställningar/ }).first().click();
  await expect(page).toHaveURL(/\/settings\/?$/);
  await showPanel(page, "Frister");
  const amount = page.getByLabel("Ofakturerat belopp (kr)");
  await expect(amount).toBeVisible({ timeout: 25_000 });
  await amount.fill(kr);
  await page.getByLabel("Äldsta ofakturerade (dagar)").fill(days);
  const panel = page.locator("div", { has: amount }).filter({ has: page.getByRole("button", { name: "Spara", exact: true }) }).last();
  await panel.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(panel.getByText("Sparat ✓")).toBeVisible();
}

/** Frister för hela byrån: raderna Bör faktureras. */
async function billNowRows(page: Page) {
  await page.getByRole("link", { name: /Frister/ }).first().click();
  await expect(page.getByRole("heading", { name: "Frister" })).toBeVisible({ timeout: 25_000 });
  await page.getByLabel("Bara mina ärenden").uncheck();
  await expect(page.getByText(/poster, varav|Inget behöver din uppmärksamhet/)).toBeVisible();
  return page.getByRole("link").filter({ hasText: "Bör faktureras" });
}

test("Inställningar → Frister: låga trösklar ger Bör faktureras, höga tar bort det (#1912)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await page.goto(`${base}/`, { waitUntil: "load" });

  await setThresholds(page, "1", "0");
  await expect((await billNowRows(page)).first()).toBeVisible({ timeout: 25_000 });

  await setThresholds(page, "20000000", "100000");
  await expect(await billNowRows(page)).toHaveCount(0, { timeout: 25_000 });
});
