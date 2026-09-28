/**
 * Osynkade ändringar mot den fulla self-hosted-stacken (#1241).
 *
 * En jurist gör en ändring medan nätet ligger nere. Då ska appen:
 *   - visa att ändringen väntar (statuspillen),
 *   - varna när webbläsaren inte lovat att behålla den lokala lagringen,
 *   - fråga innan utloggning — "Avbryt" behåller sessionen och ändringen,
 * och när nätet kommer tillbaka synkas ändringen och utloggningen går igenom
 * utan fråga.
 *
 * Webbläsarens svar på `persist()` är heuristiskt, så det låses här med ett
 * init-skript (nekat) för att varningen ska kunna provas deterministiskt.
 */
import { test, expect, type Page } from "@playwright/test";
import { login } from "./_selfhosted-login";

async function denyPersistentStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, "persisted", { configurable: true, value: async () => false });
    Object.defineProperty(StorageManager.prototype, "persist", { configurable: true, value: async () => false });
  });
}

test("ändring offline → varning + fråga vid utloggning; online → synkas och utloggning utan fråga", async ({ page, context }) => {
  await denyPersistentStorage(page);
  await login(page, "lawyer", "lawyer");

  await page.goto("/ava/contacts/");
  const pill = page.getByTestId("sync-pill");
  await expect(pill).toContainText(/Sparat|Inte synkat/, { timeout: 30_000 });

  await context.setOffline(true);
  const name = `Offline-kontakt ${Date.now()}`;
  await page.getByRole("button", { name: "+ Ny kontakt" }).click();
  await page.getByLabel("Namn *").fill(name);
  await page.getByRole("button", { name: "Spara kontakt" }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });

  await expect(pill).toContainText(/Off-line — 1 ändring väntar/, { timeout: 15_000 });
  await expect(page.getByTestId("storage-warning")).toBeVisible();

  // Utloggning med en osynkad ändring → fråga. "Avbryt" → kvar, inloggad.
  const dialogs: string[] = [];
  page.once("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.getByRole("button", { name: "Logga ut" }).first().click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("1 ändring har inte nått servern");
  await expect(page).toHaveURL(/\/ava\/contacts\/?$/);
  await expect(page.getByText(name).first()).toBeVisible();

  // Nätet tillbaka → ändringen synkas, varningen försvinner.
  await context.setOffline(false);
  await expect(pill).toContainText("Sparat", { timeout: 45_000 });
  await expect(page.getByTestId("storage-warning")).toHaveCount(0);

  // Nu loggas man ut utan fråga.
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.getByRole("button", { name: "Logga ut" }).first().click();
  await expect(page).toHaveURL(/\/login\/?$/, { timeout: 15_000 });
  expect(dialogs).toHaveLength(1);
});
