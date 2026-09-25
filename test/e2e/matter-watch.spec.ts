/**
 * E2E (#1162/#1167): en bevakning med dagens datum i ärendets "Att bevaka"
 * lyser rött där OCH i "Att bevaka" på startsidan — EN lista. Demon håller
 * ändringar i minnet, så vi går till startsidan via menyn (klient-navigering).
 */

import { DEMO_BASE_URL, fetchDemoSeed, matterIdWith, seedDemoLogin, test, expect } from "./_demo-test";

test("bevakning idag: röd i ärendet och i Att bevaka på startsidan", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matterId = matterIdWith(seed, "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const section = page.getByRole("region", { name: "Att bevaka" });
  await expect(section).toBeVisible({ timeout: 25_000 });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await section.getByLabel("Bevakning", { exact: true }).fill("E2E-bevakning: överklagandefrist");
  await section.getByLabel("Bevakningsdatum").fill(today);
  await section.getByRole("button", { name: "Lägg till" }).click();

  const row = section.locator("li", { hasText: "E2E-bevakning: överklagandefrist" });
  await expect(row.getByRole("alert")).toHaveText("FRIST IDAG");

  await page.getByRole("link", { name: /Startsida/ }).first().click();
  const watchRow = page.locator("li", { hasText: "E2E-bevakning: överklagandefrist" });
  await expect(watchRow).toBeVisible({ timeout: 15_000 });
  await expect(watchRow.getByRole("alert")).toHaveText("FRIST IDAG");
  await expect(page.getByRole("heading", { name: /Kalender/ })).toBeVisible();
  await expect(page.getByText("Att göra", { exact: true })).toHaveCount(0);
});
