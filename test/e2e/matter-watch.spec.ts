/**
 * E2E (#1162/#1167/#1735): en frist med dagens datum i ärendets "Frister"
 * lyser rött där OCH i "Frister" på startsidan — EN lista. Demon håller
 * ändringar i minnet, så vi går till startsidan via menyn (klient-navigering).
 */

import { DEMO_BASE_URL, fetchDemoSeed, matterIdWith, seedDemoLogin, test, expect } from "./_demo-test";

test("frist idag: röd i ärendet och i Frister på startsidan", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matterId = matterIdWith(seed, "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  // Innersta: dockview märker även panelens yta med titeln (#1185).
  const section = page.getByRole("region", { name: "Frister" }).last();
  await expect(section).toBeVisible({ timeout: 25_000 });

  // "Idag" i byråns tid — samma dag som appen räknar med (stockholmDay), inte
  // testmaskinens UTC-datum (som är gårdagen mellan 22 och 24 UTC).
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  await section.getByLabel("Frist", { exact: true }).fill("E2E-frist: överklagandefrist");
  await section.getByLabel("Datum", { exact: true }).fill(today);
  await section.getByRole("button", { name: "Lägg till" }).click();

  const row = section.locator("li", { hasText: "E2E-frist: överklagandefrist" });
  await expect(row.getByRole("alert")).toHaveText("FRIST IDAG");

  await page.getByRole("link", { name: /Startsida/ }).first().click();
  const watchRow = page.locator("li", { hasText: "E2E-frist: överklagandefrist" });
  await expect(watchRow).toBeVisible({ timeout: 15_000 });
  await expect(watchRow.getByRole("alert")).toHaveText("FRIST IDAG");
  await expect(page.getByRole("heading", { name: /Tidrapportering/ })).toBeVisible();
  await expect(page.getByText("Att göra", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /🔔 Frister/ })).toBeVisible();
});

test("Radera: fristen försvinner ur ärendets Frister efter bekräftelse (#1231)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matterId = matterIdWith(seed, "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const section = page.getByRole("region", { name: "Frister" }).last();
  await expect(section).toBeVisible({ timeout: 25_000 });

  const title = "E2E-frist: felaktig dom";
  await section.getByLabel("Frist", { exact: true }).fill(title);
  await section.getByLabel("Datum", { exact: true }).fill("2030-01-15");
  await section.getByRole("button", { name: "Lägg till" }).click();
  const row = section.locator("li", { hasText: title });
  await expect(row).toBeVisible();

  page.once("dialog", (d) => { void d.accept(); });
  await row.getByRole("button", { name: `Radera: ${title}` }).click();
  await expect(row).toHaveCount(0);
});
