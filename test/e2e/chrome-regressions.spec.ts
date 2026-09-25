/**
 * E2E (#1170) — fel som bara syntes i Chrome, körs i Chromium i CI:
 *  - kolumnbredd: dra i kolumnkanten ändrade inget (markören ändrades, men
 *    automatisk tabell-layout höll kolumnen kvar)
 *  - tidsposter som ingår i slutfaktura/kostnadsräkning visade "Ändra" men
 *    sparandet föll tyst; nu "🔒 Låst", och olåsta sparas
 */

import { DEMO_BASE_URL, fetchDemoSeed, seedDemoLogin, test, expect } from "./_demo-test";

test("kolumnbredd går att ändra genom att dra i kanten", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await page.goto(`${base}/users/`);
  const th = page.locator("table thead th").first();
  await th.waitFor({ timeout: 25_000 });
  const handle = th.getByRole("separator", { name: "Ändra kolumnbredd" });
  await handle.hover();
  const before = (await th.boundingBox())!.width;
  const hb = (await handle.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2, { steps: 12 });
  await page.mouse.up();
  const after = (await th.boundingBox())!.width;
  expect(after - before).toBeGreaterThan(100);
});

test("låsta tidsposter visar Låst; en olåst post går att ändra och spara", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const entries = seed.timeEntries;
  const byMatter = new Map<string, { frozen: number; open: number }>();
  for (const e of entries) {
    const c = byMatter.get(e.matterId) ?? { frozen: 0, open: 0 };
    if (e.frozenAt) c.frozen++; else c.open++;
    byMatter.set(e.matterId, c);
  }
  const matterId = [...byMatter].find(([, c]) => c.frozen > 0 && c.open > 0)?.[0];
  expect(matterId, "seeden saknar ärende med både låsta och olåsta tidsposter").toBeTruthy();

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const timeTable = page.locator("table", { has: page.locator("th", { hasText: "Kategori" }) }).first();
  await timeTable.waitFor({ timeout: 25_000 });
  await expect(timeTable.getByText("🔒 Låst").first()).toBeVisible();

  await timeTable.locator("tbody button", { hasText: /^Ändra$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Ändra tidregistrering" });
  await dialog.locator("#time-description").fill("Ändrad i Chromium-e2e");
  await dialog.getByRole("button", { name: /Spara/ }).click();
  await expect(dialog).toBeHidden();
  await expect(timeTable.getByText("Ändrad i Chromium-e2e")).toBeVisible();
});
