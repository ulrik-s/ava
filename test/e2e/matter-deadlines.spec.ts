/**
 * E2E (#1162): en frist med dagens datum lyser rött i ärendet OCH syns i den
 * röda rutan på startsidan. Demon håller ändringar i minnet, så vi går till
 * startsidan via menyn (klient-navigering), inte med en omladdning.
 */

import { DEMO_BASE_URL, fetchDemoSeed, matterIdWith, seedDemoLogin, test, expect } from "./_demo-test";

test("frist idag: röd i ärendet och på startsidan", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matterId = matterIdWith(seed, "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: /Att göra & frister/ })).toBeVisible({ timeout: 25_000 });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const section = page.getByRole("region", { name: "Att göra och frister" });
  await section.getByLabel("Att göra / frist").fill("E2E-frist: inkomma med yttrande");
  await section.getByLabel("Frist", { exact: true }).fill(today);
  await section.getByRole("button", { name: "Lägg till" }).click();

  const row = section.locator("li", { hasText: "E2E-frist: inkomma med yttrande" });
  await expect(row.getByRole("alert")).toHaveText("FRIST IDAG");

  await page.getByRole("link", { name: /Startsida/ }).first().click();
  const alert = page.getByRole("region", { name: "Frister som är inne" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText("E2E-frist: inkomma med yttrande");
  // Demodatan har egna försenade uppgifter — kolla just vår rad.
  await expect(alert.locator("li", { hasText: "E2E-frist: inkomma med yttrande" }).getByRole("alert")).toHaveText("FRIST IDAG");
});
