/**
 * Dockbar ärendesida (#1185): ingen sidscroll på 13"-laptop, stor skärm och
 * telefon; flikar går att dra till en annan grupp; "Återställ layout" ger
 * standarden tillbaka.
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL, fetchDemoSeed, matterIdWith, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

async function openMatter(page: Page, base: string): Promise<void> {
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  await page.goto(`${base}/matters/${matterIdWith(seed, "timeEntries")}/`, { waitUntil: "load" });
  await expect(page.getByRole("tab", { name: /^Tid/ }).first()).toBeVisible({ timeout: 30_000 });
}

const pageScroll = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("main");
  return {
    doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    main: main ? main.scrollHeight - main.clientHeight : 0,
  };
});

for (const [name, width, height] of [["13\" laptop", 1470, 956], ["stor skärm", 2560, 1440], ["telefon", 390, 844]] as const) {
  test(`ingen sidscroll på ${name}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
    await showPanel(page, "Dokument");
    expect(await pageScroll(page)).toEqual({ doc: 0, main: 0 });
  });
}

/** Varje panelsida: en panel som ska finnas, och hur man tar sig dit. */
const PANEL_PAGES = [
  { name: "startsidan", path: () => "/", tab: "Kalender" },
  { name: "en faktura", path: (s: Awaited<ReturnType<typeof fetchDemoSeed>>) => `/invoices/${s.invoices[0]?.id ?? ""}/`, tab: "Betalningar" },
  { name: "en kontakt", path: (s: Awaited<ReturnType<typeof fetchDemoSeed>>) => `/contacts/${s.contacts[0]?.id ?? ""}/`, tab: "Ärenden" },
  { name: "inställningar", path: () => "/settings/", tab: "Standardåtgärder" },
  { name: "rapporter", path: () => "/reports/", tab: "Veckor" },
  { name: "kalendern", path: () => "/calendar/", tab: "Uppgifter" },
  { name: "jobbkön", path: () => "/jobs/", tab: "Historik" },
  { name: "min profil", path: () => "/profile/", tab: "Anslutna tjänster" },
  { name: "betalfilsimporten", path: () => "/payments/import/", tab: "Matchning" },
] as const;

for (const p of PANEL_PAGES) {
  test(`${p.name}: paneler och ingen sidscroll (13" och telefon)`, async ({ page, baseURL }) => {
    const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
    await seedDemoLogin(page, base);
    const seed = await fetchDemoSeed(page, base);
    for (const [width, height] of [[1470, 956], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}${p.path(seed)}`, { waitUntil: "load" });
      await showPanel(page, p.tab);
      expect(await pageScroll(page)).toEqual({ doc: 0, main: 0 });
    }
  });
}

/** Listsidor: huvudet står still, listan scrollar inuti — sidan aldrig. */
const LIST_PAGES = ["/matters/", "/contacts/", "/invoices/", "/time/", "/payment-plans/", "/users/", "/templates/", "/search/", "/watchlist/", "/conflicts/"];

for (const path of LIST_PAGES) {
  test(`listsida ${path}: ingen sidscroll (13" och telefon)`, async ({ page, baseURL }) => {
    const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
    await seedDemoLogin(page, base);
    for (const [width, height] of [[1470, 956], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
      expect(await pageScroll(page)).toEqual({ doc: 0, main: 0 });
    }
  });
}

/** Gruppen (dockviews flikrad) en flik ligger i. */
const groupOf = (page: Page, title: string) =>
  page.locator(".dv-groupview").filter({ has: page.getByRole("tab", { name: new RegExp(`^${title}`) }) });

test("dra en flik till en annan grupp och återställ", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const kontakter = page.getByRole("tab", { name: /^Kontakter/ });
  await expect(groupOf(page, "Tid").getByRole("tab", { name: /^Kontakter/ })).toHaveCount(0);

  await kontakter.dragTo(page.getByRole("tab", { name: /^Utlägg/ }));
  await expect(groupOf(page, "Tid").getByRole("tab", { name: /^Kontakter/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Återställ layout" }).click();
  await expect(groupOf(page, "Att bevaka").getByRole("tab", { name: /^Kontakter/ })).toHaveCount(1, { timeout: 15_000 });
});
