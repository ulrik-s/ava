/**
 * E2E-regression för dokumentlistans kebab-meny (⋮) + responsiv tabell.
 *
 * Bakgrund: rad-actions låg inline → raden blev för bred → horisontell
 * scroll på små skärmar. Nu samlas alla actions i en touch-vänlig
 * overflow-meny, och sekundära kolumner (Storlek/Datum) döljs < sm.
 *
 * Fångar två buggar jsdom-testerna missar:
 *   1. Menyn stängdes direkt vid klick eftersom scroll-lyssnaren använde
 *      capture=true och fångade `overflow-x-auto`-wrapperns scroll-into-view.
 *   2. Auto-table-layout lät namn-kolumnen växa → tabellen överflödade
 *      containern (fixat med table-fixed + break-words + kolumn-döljning).
 *
 * Kör mot live GH Pages (default) eller lokalt demo-bygge:
 *   AVA_DEMO_BASE_URL=http://localhost:8099/ava npx playwright test kebab-verify
 * Mot localhost måste demo-läge tvingas (localhost defaultar self-hosted).
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.AVA_DEMO_BASE_URL ?? "https://ulrik-s.github.io/ava";
const isLocal = /localhost|127\.0\.0\.1/.test(BASE);

test.beforeEach(async ({ page }) => {
  if (!isLocal) return;
  // localhost defaultar till self-hosted (→ 401). Tvinga demo mot samma-origin.
  await page.addInitScript((origin) => {
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "demo", repo: origin, token: "",
      organizationId: "demo-firma-ab", authorName: "AVA Demo", authorEmail: "demo@ava.local",
    }));
  }, BASE);
});

async function gotoMatter(page: Page) {
  await page.goto(`${BASE}/matters/m-001-vardnad/`);
  await page.getByLabel("Dokumentåtgärder").first().waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1500); // demo-bootstrap invalidateQueries settle
}

test("dokumentrad: kebab-meny öppnas med alla actions + Escape stänger", async ({ page }) => {
  await gotoMatter(page);
  await page.getByLabel("Dokumentåtgärder").first().click();

  const menu = page.getByRole("menu", { name: "Dokumentåtgärder" });
  await expect(menu).toBeVisible();
  for (const label of ["Öppna i webbläsaren", "Editera externt", "Visa", "Ladda ner", "Analysera", "Ta bort"]) {
    await expect(menu.getByText(new RegExp(label))).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("dokumenttabellen scrollar inte horisontellt på mobil (390px)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await gotoMatter(page);

  const overflow = await page.evaluate(() => {
    const kebab = document.querySelector('[aria-label="Dokumentåtgärder"]');
    const wrap = kebab?.closest("div.overflow-x-auto") as HTMLElement | null;
    return wrap ? wrap.scrollWidth - wrap.clientWidth : null;
  });
  expect(overflow, "dok-tabellens overflow-wrapper hittades").not.toBeNull();
  expect(overflow!, "ingen horisontell scroll i dokumenttabellen på mobil").toBeLessThanOrEqual(2);
});
