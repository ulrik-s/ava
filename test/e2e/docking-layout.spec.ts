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
  { name: "min profil", path: () => "/profile/", tab: "Uppgifter" }, // Anslutna tjänster finns bara med integrationer (#1213)
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

test("maximera Dokument-panelen och återställ den (#1263)", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  await showPanel(page, "Dokument");
  const docGroup = groupOf(page, "Dokument");
  const width = async (): Promise<number> => (await docGroup.boundingBox())?.width ?? 0;
  const normal = await width();

  // Maximera: Dokument-gruppen tar hela arbetsytan (dockview döljer övriga grupper).
  await docGroup.getByRole("button", { name: "Maximera panelen" }).click();
  await expect(page.getByRole("button", { name: "Återställ panelen" })).toBeVisible();
  await expect.poll(width).toBeGreaterThan(normal + 200);

  // Escape återställer till ursprunglig storlek.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Återställ panelen" })).toHaveCount(0);
  await expect.poll(width).toBeLessThan(normal + 20);

  // Maximeringen sparas aldrig: efter omladdning är layouten inte maximerad.
  await docGroup.getByRole("button", { name: "Maximera panelen" }).click();
  await expect(page.getByRole("button", { name: "Återställ panelen" })).toBeVisible();
  await page.waitForTimeout(1200); // låt en ev. (debouncad) layoutsparning ske
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("tab", { name: /^Tid/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Återställ panelen" })).toHaveCount(0);
});

/** Varje grupps storlek (bredd×höjd), i dockviews ordning. */
const groupSizes = (page: Page) => page.locator(".dv-groupview").evaluateAll((els) =>
  els.map((g) => { const r = g.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));

// Tiling-fönsterhanterare (#1291): fönstret byter storlek medan en panel är
// maximerad. Dockview återställde då de dolda gruppernas GAMLA pixelstorlekar,
// och layouten blev skev för gott (374/776 i stället för 575/575). I ett litet
// fönster kläms en grupp ihop så att flikarna knappt syns.
test("maximera, fönstret byter storlek, återställ → proportionerna består", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const before = await groupSizes(page);

  await page.getByRole("button", { name: "Maximera panelen" }).first().click();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.getByRole("button", { name: "Återställ panelen" }).click();
  await page.setViewportSize({ width: 1470, height: 956 });

  const sameAsBefore = async (): Promise<boolean> => {
    const after = await groupSizes(page);
    return after.every((s, i) => Math.abs(s.w - (before[i]?.w ?? 0)) <= 3 && Math.abs(s.h - (before[i]?.h ?? 0)) <= 3);
  };
  await expect.poll(sameAsBefore, { message: `layouten ska ha samma proportioner som före maximeringen (${JSON.stringify(before)})` }).toBe(true);

  // Den sparade layouten är inte heller skev (dockview serialiserade förut de gamla pixlarna).
  await page.waitForTimeout(1200); // låt den debouncade sparningen ske
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("tab", { name: /^Tid/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(sameAsBefore, { message: "efter omladdning" }).toBe(true);
});

test("maximera i ett litet fönster, återställ i ett stort → proportionerna består", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const before = await groupSizes(page);

  await page.setViewportSize({ width: 900, height: 600 });
  await page.getByRole("button", { name: "Maximera panelen" }).nth(1).click();
  await page.setViewportSize({ width: 1470, height: 956 });
  await page.getByRole("button", { name: "Återställ panelen" }).click();

  await expect.poll(async () => {
    const after = await groupSizes(page);
    return after.every((s, i) => Math.abs(s.w - (before[i]?.w ?? 0)) <= 3 && Math.abs(s.h - (before[i]?.h ?? 0)) <= 3);
  }, { message: `layouten ska ha samma proportioner som före maximeringen (${JSON.stringify(before)})` }).toBe(true);
});

// #1292: en sida har en fast uppsättning paneler. Flikens × (och mittenklick)
// stängde panelen, och den var borta tills sidan laddades om — "flikarna
// visades inte under ärende".
test("flikarna går inte att stänga — varken med × eller mittenklick", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const tabs = await page.getByRole("tab").count();
  await expect(page.locator(".dv-default-tab-action")).toHaveCount(0);
  await page.getByRole("tab", { name: /^Tid/ }).click({ button: "middle" });
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

// #1292: flikar som inte ryms låg bakom en nästan osynlig "⌄ 1".
test("smal grupp: dolda flikar nås via en tydlig knapp, även med tangentbordet", async ({ page, baseURL }) => {
  // En halv skärm i en tiling-fönsterhanterare, och fler flikar i Tid-gruppen
  // än den rymmer.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  for (const t of ["Kontakter", "Betalningssätt", "Händelser"]) {
    await page.getByRole("tab", { name: new RegExp(`^${t}`) }).dragTo(page.getByRole("tab", { name: /^Utlägg/ }));
  }
  const more = groupOf(page, "Tid").getByRole("button", { name: /^\d+ dold(a)? flik(ar)?$/ });
  await expect(more).toBeVisible();
  await expect(more).toHaveAccessibleName(/^\d+ dolda flikar$/);
  // Namnet följer siffran på knappen — även när gruppen ändras.
  const nameMatchesBadge = async (): Promise<boolean> =>
    (await more.getAttribute("aria-label")) === `${((await more.textContent()) ?? "").trim()} dolda flikar`;
  await expect.poll(nameMatchesBadge).toBe(true);
  await page.getByRole("tab", { name: /^Förslag/ }).dragTo(page.getByRole("tab", { name: /^Utlägg/ }));
  await expect.poll(nameMatchesBadge).toBe(true);

  await more.focus();
  await page.keyboard.press("Enter");
  // Listan (dockviews popover) visar de dolda flikarna; välj den sista.
  const list = page.locator(".dv-tabs-overflow-container");
  await expect(list).toBeVisible();
  const hidden = list.locator(".dv-default-tab-content").last();
  const title = (await hidden.textContent()) ?? "";
  await hidden.click();
  await expect(page.getByRole("tab", { name: new RegExp(`^${title}`) })).toHaveAttribute("aria-selected", "true");
});

// #1293: den maximerade panelen återställs med en synlig knapp (testet ovan
// använde bara Escape), och ett Escape som stänger en dialog återställer inte
// också panelen.
test("maximerad panel: synlig Återställ-knapp, och Escape stänger dialogen först", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const tid = groupOf(page, "Tid");
  const before = await groupSizes(page);

  await tid.getByRole("button", { name: "Maximera panelen" }).click();
  const restore = page.getByRole("button", { name: "Återställ panelen" });
  await expect(restore).toBeVisible();
  await expect(restore).toHaveText("Återställ");
  await restore.click();
  await expect(restore).toHaveCount(0);
  await expect.poll(async () => (await groupSizes(page)).length).toBe(before.length);

  await tid.getByRole("button", { name: "Maximera panelen" }).click();
  await tid.getByRole("button", { name: /Registrera tid/ }).click();
  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(restore).toBeVisible(); // fortfarande maximerad
  await page.keyboard.press("Escape");
  await expect(restore).toHaveCount(0);
});
