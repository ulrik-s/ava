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
 * Kör mot lokalt serverad `out/` (default) eller mot live GH Pages:
 *   bun run build:demo && bun tooling/scripts/serve-demo-static.ts &
 *   npx playwright test kebab-verify --config tooling/config/playwright-demo.config.ts
 *   AVA_DEMO_BASE_URL=https://ulrik-s.github.io/ava npx playwright test kebab-verify
 */

import { type Page } from "@playwright/test";

import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test.beforeEach(async ({ page }) => {
  // localhost defaultar till self-hosted (→ 401) → tvinga demo. Seedas även mot
  // live: `repo: ""` ger same-origin i båda lägena, så vägen är densamma.
  await seedDemoLogin(page, BASE);
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
