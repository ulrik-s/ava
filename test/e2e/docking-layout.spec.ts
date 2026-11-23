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
  { name: "startsidan", path: () => "/", tab: "Senaste ärenden" },
  { name: "en faktura", path: (s: Awaited<ReturnType<typeof fetchDemoSeed>>) => `/invoices/${s.invoices[0]?.id ?? ""}/`, tab: "Betalningar" },
  { name: "en kontakt", path: (s: Awaited<ReturnType<typeof fetchDemoSeed>>) => `/contacts/${s.contacts[0]?.id ?? ""}/`, tab: "Ärenden" },
  { name: "inställningar", path: () => "/settings/", tab: "Standardåtgärder" },
  { name: "rapporter", path: () => "/reports/", tab: "Veckor" },
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
const LIST_PAGES = ["/matters/", "/contacts/", "/invoices/", "/time/", "/payment-plans/", "/users/", "/templates/", "/search/", "/watchlist/"];

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
  const kontakter = page.getByRole("tab", { name: /^Parter/ });
  await expect(groupOf(page, "Tid").getByRole("tab", { name: /^Parter/ })).toHaveCount(0);

  await kontakter.dragTo(page.getByRole("tab", { name: /^Utlägg/ }));
  await expect(groupOf(page, "Tid").getByRole("tab", { name: /^Parter/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Återställ layout" }).click();
  await expect(groupOf(page, "Frister").getByRole("tab", { name: /^Parter/ })).toHaveCount(1, { timeout: 15_000 });
});

// #1844: avdelningen går ut till rutans kant och rubrikraden är tät.
test("ärendets Tid: rubrikraden börjar vid panelens överkant och är lägre än 45 px", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const tid = page.getByRole("region", { name: "Tid" }).last();
  const heading = tid.getByRole("heading", { name: /^Tidregistrering/ });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  // Rubrikrad → avdelningen → panelkroppen (PanelHost), under dockviews flikrad.
  const header = await heading.locator("xpath=..").boundingBox();
  const panel = await heading.locator("xpath=../../..").boundingBox();
  expect(panel && header).toBeTruthy();
  expect(Math.abs((header?.y ?? 0) - (panel?.y ?? 100))).toBeLessThanOrEqual(1);
  expect(header?.height ?? 100).toBeLessThan(45);
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
  for (const t of ["Parter", "Anteckningar", "Händelser"]) {
    await page.getByRole("tab", { name: new RegExp(`^${t}`) }).dragTo(page.getByRole("tab", { name: /^Utlägg/ }));
  }
  // dockview räknar om `+N` när flikraden byter storlek eller scrollas, inte när
  // en flik läggs till i en rad som redan är full. Med feta fliknamn (#1672)
  // blir raden full tidigare, så scrolla den som en användare gör.
  await groupOf(page, "Tid").locator(".dv-tabs-container").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
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

// #1356: dockview stängde en fokuserad flik med Delete/Backspace trots att
// stängknappen är dold, och shift-klick/-drag i flikraden skapade en flytande
// grupp som låg ovanpå panelerna.
test("Delete/Backspace stänger inte en flik, och flytande grupper går inte att skapa", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const tabs = await page.getByRole("tab").count();
  const tid = page.getByRole("tab", { name: /^Tid/ });
  await tid.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("tab")).toHaveCount(tabs);
  await expect(tid).toBeFocused(); // fokus står kvar på fliken
  await page.keyboard.press("ArrowRight"); // flikraden går fortfarande att navigera
  await expect(tid).not.toBeFocused();

  // Shift-klick i flikradens tomma yta (och shift-drag av en flik) gör inget flytande.
  await groupOf(page, "Tid").locator(".dv-void-container").click({ modifiers: ["Shift"] });
  await page.keyboard.down("Shift");
  await page.getByRole("tab", { name: /^Utlägg/ }).dragTo(page.locator(".dv-groupview").last(), { targetPosition: { x: 200, y: 200 } });
  await page.keyboard.up("Shift");
  await expect(page.locator(".dv-resize-container")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

// #1612: Startsidans rutor tas bort med × och läggs tillbaka
// med "Lägg till ruta". Valet består vid navigering (demon sparar inte över
// en omladdning, så vi navigerar inom appen).
test("Startsidan: ta bort Tidrapportering med ×, den förblir borta, och Lägg till ruta ger den tillbaka", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await page.goto(`${base}/`, { waitUntil: "load" });
  const tidTab = page.getByRole("tab", { name: /^Tidrapportering/ });
  await expect(tidTab).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Lägg till ruta" })).toBeDisabled();

  await tidTab.locator(".dv-default-tab-action").click();
  await expect(tidTab).toHaveCount(0);

  await page.getByRole("link", { name: /Ärenden/ }).first().click();
  await expect(page).toHaveURL(/\/matters\/?$/);
  await page.getByRole("link", { name: /Startsida/ }).first().click();
  await expect(page.getByRole("tab", { name: /^Frister/ })).toBeVisible({ timeout: 30_000 });
  await expect(tidTab).toHaveCount(0);

  await page.getByRole("button", { name: "Lägg till ruta" }).click();
  await page.getByRole("menuitem", { name: "Tidrapportering" }).click();
  await expect(tidTab).toBeVisible();
  await expect(tidTab).toHaveAttribute("aria-selected", "true");
});

// #1623: Kalendern är borttagen — ingen ruta på Startsidan, ingen menypost,
// och gamla bokmärken till /calendar/ hamnar på Startsidan.
test("Startsidan och menyn saknar Kalender, och /calendar/ skickar till Startsidan", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await page.goto(`${base}/calendar/`, { waitUntil: "load" });
  await expect(page).toHaveURL(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Startsida", level: 1 })).toBeVisible({ timeout: 30_000 });
  for (const title of ["Frister", "Tidrapportering", "Senaste ärenden"]) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${title}`) })).toBeVisible();
  }
  await expect(page.getByRole("tab", { name: /^Kalender/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Kalender/ })).toHaveCount(0);
});

// #1635: flikar och avdelare i ljust läge — nästan svart fliktext, vald flik
// markerad med mer än textfärgen, mörkare flikrad, synliga gruppkanter. Mörkt
// läge har dockviews mörka tema precis som förut.
const tabLook = (page: Page) => page.evaluate(() => {
  const style = (sel: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
  const sep = document.querySelector(".dv-split-view-container.dv-separator-border > .dv-view-container > .dv-view:not(:first-child)");
  return {
    row: style(".dv-tabs-and-actions-container")?.backgroundColor,
    group: style(".dv-groupview")?.backgroundColor,
    groupOutline: style(".dv-groupview")?.outlineStyle,
    activeColor: style(".dv-active-group .dv-tab.dv-active-tab")?.color,
    activeMark: style(".dv-tab.dv-active-tab")?.boxShadow,
    inactiveColor: style(".dv-tab.dv-inactive-tab")?.color,
    inactiveBg: style(".dv-tab.dv-inactive-tab")?.backgroundColor,
    activeWeight: style(".dv-tab.dv-active-tab")?.fontWeight,
    inactiveWeight: style(".dv-tab.dv-inactive-tab")?.fontWeight,
    separator: sep ? getComputedStyle(sep, "::before").backgroundColor : null,
  };
});

async function openLight(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await expect(page.locator(".dv-tab.dv-active-tab").first()).toBeVisible({ timeout: 30_000 });
}

test("ljust läge: tydliga flikar och avdelare på Startsidan och ett ärende (#1635)", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  await page.addInitScript(() => { localStorage.setItem("ava.theme", "light"); });
  const light = {
    row: "rgb(209, 213, 219)", group: "rgb(255, 255, 255)", groupOutline: "solid",
    activeColor: "rgb(17, 24, 39)", activeMark: "rgb(37, 99, 235) 0px 3px 0px 0px inset", separator: "rgb(107, 114, 128)",
    activeWeight: "600", // feta fliknamn (#1672)
  };
  // Startsidan har en flik per grupp; ärendet har inaktiva flikar bredvid de valda.
  await openLight(page, base, "/");
  expect(await tabLook(page)).toMatchObject(light);
  await openLight(page, base, `/matters/${matterIdWith(seed, "timeEntries")}/`);
  expect(await tabLook(page)).toEqual({ ...light, inactiveColor: "rgb(17, 24, 39)", inactiveBg: "rgb(209, 213, 219)", inactiveWeight: "600" });
});

/** Summan av `+N` i dockytans överflödesknappar, och flikrader som inte rymmer sina flikar. */
const hiddenTabs = (page: Page) => page.evaluate(() => ({
  badges: [...document.querySelectorAll(".dv-tabs-overflow-dropdown-default")]
    .reduce((sum, el) => sum + (Number.parseInt(el.textContent, 10) || 0), 0),
  fullRows: [...document.querySelectorAll(".dv-tabs-container")].filter((el) => el.scrollWidth > el.clientWidth).length,
}));

test("ljust läge: feta fliknamn döljer inga fler flikar vid 13\" (#1672)", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  await page.addInitScript(() => { localStorage.setItem("ava.theme", "light"); });
  for (const path of ["/", `/matters/${matterIdWith(seed, "timeEntries")}/`]) {
    await openLight(page, base, path);
    expect(await hiddenTabs(page)).toEqual({ badges: 0, fullRows: 0 });
  }
});

test("mörkt läge: dockytans flikar oförändrade (#1635)", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await page.addInitScript(() => { localStorage.setItem("ava.theme", "dark"); });
  await openMatter(page, base);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await tabLook(page)).toEqual({
    row: "rgb(37, 37, 38)", group: "rgb(30, 30, 30)", groupOutline: "none",
    activeColor: "rgb(255, 255, 255)", activeMark: "none",
    inactiveColor: expect.stringMatching(/^rgb\((150, 150, 150|98, 98, 98)\)$/), inactiveBg: "rgb(45, 45, 45)", separator: "rgb(68, 68, 68)",
    activeWeight: "400", inactiveWeight: "400",
  });
});
