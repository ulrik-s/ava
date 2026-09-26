/**
 * E2E (#1221): faktureringsåtgärder syns i "Att bevaka". Demodatat har en
 * skapad men oskickad faktura — den ska ligga under filtret "Fakturering" som
 * "Skicka faktura …" med 💼, och leda till ärendet.
 */

import { DEMO_BASE_URL, seedDemoLogin, test, expect } from "./_demo-test";

test("oskickad faktura: 'Skicka faktura' under Fakturering i Att bevaka", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await page.goto(`${base}/watchlist/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Att bevaka" })).toBeVisible({ timeout: 25_000 });

  // Hela byrån — demoanvändaren är inte ansvarig för alla ärenden.
  await page.getByLabel("Bara mina ärenden").uncheck();
  await page.getByRole("button", { name: "Fakturering" }).click();

  const row = page.locator("li", { hasText: /Skicka faktura F-\d{4}-\d+/ }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("💼");
  await expect(row.getByRole("link")).toHaveAttribute("href", /\/matters\//);
});
