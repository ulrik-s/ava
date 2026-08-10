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
});

/** Sätt vyläget FÖRE första render — `DocumentBrowser` läser det i sin initState. */
async function useViewMode(page: Page, mode: "tree" | "list"): Promise<void> {
  await page.addInitScript(([key, m]) => {
    try { localStorage.setItem(key!, m!); } catch { /* privat läge */ }
  }, [VIEW_MODE_KEY, mode]);
}

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

/** Överflödet i dokumenttabellens scroll-wrapper — 0 betyder "ingen scroll". */
async function tableOverflow(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const kebab = document.querySelector('[aria-label="Dokumentåtgärder"]');
    const wrap = kebab?.closest("div.overflow-x-auto") as HTMLElement | null;
    return wrap ? wrap.scrollWidth - wrap.clientWidth : null;
  });
}

/**
 * Kebab-knappen, centrerad i vyn innan den klickas.
 *
 * Utan centreringen ligger första dokumentraden precis vid nederkanten sedan
 * dokumenten filats i mappar (#985) — mapp-raderna tar plats — och Playwrights
 * implicita scroll-then-click svälde då FÖRSTA klicket: menyn öppnades först på
 * andra försöket. `scrollIntoViewIfNeeded` räcker inte, den lämnar elementet
 * kvar vid kanten. Artefakt av hur testet klickar, inte av appen: en användare
 * scrollar och klickar sedan på en knapp som står stilla.
 */
async function clickKebab(page: Page): Promise<void> {
  const btn = page.getByLabel("Dokumentåtgärder").first();
  await btn.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
  await btn.click();
}

// Båda vyerna granskas, och med SAMMA krav (#983). Listvyn är default och var
// otäckt fram till dess: den byggde en egen, kortare kebab och saknade
// kolumn-döljning, så den överflödade med 456 px på en 390 px-skärm.
for (const mode of ["tree", "list"] as const) {
  test(`dokumentrad (${mode}-vy): kebab-meny öppnas med alla actions + Escape stänger`, async ({ page }) => {
    await useViewMode(page, mode);
    await gotoMatter(page);
    await clickKebab(page);

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

  test(`dokumenttabellen (${mode}-vy) scrollar inte horisontellt på mobil (390px)`, async ({ page }) => {
    await useViewMode(page, mode);
    await page.setViewportSize({ width: 390, height: 800 });
    await gotoMatter(page);

    const overflow = await tableOverflow(page);
    expect(overflow, "dok-tabellens overflow-wrapper hittades").not.toBeNull();
    expect(overflow!, "ingen horisontell scroll i dokumenttabellen på mobil").toBeLessThanOrEqual(2);
  });
}

test("listvyns dolda kolumner kommer tillbaka på desktop", async ({ page }) => {
  // Halva `hideBelow`-kontraktet är att kolumnen ÅTERKOMMER. En trasig klass
  // (t.ex. interpolerad så Tailwind aldrig genererat den) hade gett en tabell
  // som ser smal och fin ut på mobil och sedan saknar kolumner överallt.
  await useViewMode(page, "list");
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoMatter(page);
  for (const label of ["Typ", "Mapp", "Uppladdad av", "Datum", "Storlek"]) {
    await expect(page.getByRole("columnheader", { name: new RegExp(label) }).first()).toBeVisible();
  }
});
