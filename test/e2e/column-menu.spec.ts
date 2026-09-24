/**
 * E2E (#1152): rubrikmenyn i en KORT tabell får inte scrolla bort raderna.
 *
 * Menyn låg absolut inuti tabellens `overflow-x-auto`-behållare. När menyn var
 * högre än tabellen blev behållaren scrollbar i höjdled: raderna scrollade upp
 * ur sikte och bara menyn syntes. Nu renderas menyn i en portal (fixed).
 */

import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test.beforeEach(async ({ page }) => {
  await seedDemoLogin(page, BASE);
});

test("rubrikmenyn i en kort tabell (användare) lämnar raderna synliga", async ({ page }) => {
  await page.goto(`${BASE}/users/`);
  const firstRow = page.locator("table tbody tr").first();
  await firstRow.waitFor({ timeout: 25_000 });

  await page.locator("table thead th button").first().click();
  // Texten, inte role — så testet når symptomet även mot den gamla menyn.
  const menuItem = page.getByText("Dölj kolumn");
  await expect(menuItem).toBeVisible();

  // Behållaren har inte scrollat och raderna syns fortfarande.
  const scrollTop = await page.locator("table").first().evaluate((t) => t.closest(".overflow-x-auto")?.scrollTop ?? 0);
  expect(scrollTop).toBe(0);
  await expect(firstRow).toBeInViewport();
  // Menyn ligger utanför tabellen (portal) och ryms i fönstret.
  expect(await menuItem.evaluate((m) => m.closest("table") === null)).toBe(true);
  await expect(menuItem).toBeInViewport();
});
