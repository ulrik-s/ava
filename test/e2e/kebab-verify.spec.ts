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

import { DEMO_BASE_URL as BASE, fetchDemoSeed, matterIdWith, seedDemoLogin, test, expect } from "./_demo-test";

/** `DocumentBrowser` läser vyläget härifrån — måste sättas FÖRE första render. */
const VIEW_MODE_KEY = "ava.documents.viewMode";

test.beforeEach(async ({ page }) => {
  // localhost defaultar till self-hosted (→ 401) → tvinga demo. Seedas även mot
  // live: `repo: ""` ger same-origin i båda lägena, så vägen är densamma.
  await seedDemoLogin(page, BASE);
  // TRÄD-vyn, inte listvyn. Det är trädets tabell som bär fixarna specen
  // granskar (`table-fixed` i document-browser.tsx, `hidden sm:table-cell` i
  // _document-row/_folder-row) och dess kebab som har hela action-uppsättningen.
  // Default är numera listvyn, som renderar den generiska `DataTable` med en
  // annan, kortare meny och utan kolumn-döljning — specen mätte alltså fel
  // tabell, vilket ingen såg eftersom den låg utanför alla configar (#932).
  // Listvyns egna brister är EGEN sak: #983.
  await page.addInitScript(([key, mode]) => {
    try { localStorage.setItem(key!, mode!); } catch { /* privat läge */ }
  }, [VIEW_MODE_KEY, "tree"]);
});

/**
 * Ett ärende som FAKTISKT har dokument — annars finns ingen kebab att öppna och
 * testet fäller på en tom tabell i stället för på menyn det granskar. Id:t slås
 * upp i seeden (#972); det hårdkodade `m-001-vardnad` slutade existera när
 * seeden gick över till UUID:n.
 */
async function gotoMatter(page: Page) {
  const seed = await fetchDemoSeed(page, BASE);
  await page.goto(`${BASE}/matters/${matterIdWith(seed, "documents")}/`);
  await page.getByLabel("Dokumentåtgärder").first().waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1500); // demo-bootstrap invalidateQueries settle
}

test("dokumentrad: kebab-meny öppnas med alla actions + Escape stänger", async ({ page }) => {
  await gotoMatter(page);
  await page.getByLabel("Dokumentåtgärder").first().click();

  const menu = page.getByRole("menu", { name: "Dokumentåtgärder" });
  await expect(menu).toBeVisible();
  for (const label of ["Öppna i webbläsaren", "Editera externt", "Visa", "Ladda ner", "Ta bort"]) {
    await expect(menu.getByText(new RegExp(label))).toBeVisible();
  }
  // "Analysera (AI)" ska INTE finnas här. ADR 0027: LLM-analys är en
  // server-förmåga, och demon har ingen server — affordansen ska då döljas, inte
  // visas och fela. Specen krävde tvärtom att den fanns, vilket bara gick att
  // tro så länge den aldrig kördes (#932/#972).
  await expect(menu.getByText(/Analysera/)).toHaveCount(0);

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
