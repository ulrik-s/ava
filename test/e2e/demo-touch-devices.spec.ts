/**
 * E2E (demo): iPhone och iPad i WebKit (#1877).
 *
 * Användarna har Safari på iPhone och iPad. Där finns risker som Chromium inte
 * visar: service workerns cache, att `innerWidth` ändras vid zoom, och
 * ikonmenyn på pekskärm. Specen körs bara i WebKit-projekten i
 * `playwright-demo.config.ts` (iPhone 390 px, iPad 768 px och iPad 820 px), med
 * projektets enhet: pekskärm och mobil-emulering. Den sätter aldrig
 * fönsterstorleken själv.
 *
 * - dock: telefonen visar en flikrad med en panel i taget; båda iPad-storlekarna
 *   visar dockytan (768 px är laptop enligt `PHONE_MAX_WIDTH`).
 * - meny: ☰ på telefonen, ikonmenyn till vänster på iPad.
 * - scroll: varken dokumentet eller `main` scrollar (som `docking-layout.spec.ts`).
 * - offline: appen öppnas offline via service workern (som `demo-offline.spec.ts`).
 */
import type { Page } from "@playwright/test";
import { PHONE_MAX_WIDTH } from "../../src/lib/shared/layout/dock-layout";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, matterIdWith, seedDemoLogin, test, expect } from "./_demo-test";

/** Är projektets enhet en telefon (skärmklassen "phone")? */
function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) <= PHONE_MAX_WIDTH;
}

async function openMatter(page: Page): Promise<string> {
  await seedDemoLogin(page, BASE);
  const id = matterIdWith(await fetchDemoSeed(page, BASE), "timeEntries", "documents");
  await page.goto(`${BASE}/matters/${id}/`, { waitUntil: "load" });
  await expect(page.getByRole("tab", { name: /^Tid/ }).first()).toBeVisible({ timeout: 30_000 });
  return id;
}

async function expectMatters(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/matters\/?$/);
  await expect(page.getByRole("heading", { name: "Ärenden / jävskontroll", level: 1, exact: true })).toBeVisible();
}

const pageScroll = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("main");
  return {
    doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    main: main ? main.scrollHeight - main.clientHeight : 0,
  };
});

/** Telefon: flikraden "Paneler" med en panel i taget, ingen dockyta. */
async function expectPhoneTabs(page: Page): Promise<void> {
  await expect(page.getByRole("tablist", { name: "Paneler" })).toBeVisible();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(page.locator(".dv-dockview")).toHaveCount(0);
}

/** iPad: dockytan, ingen telefonflikrad. */
async function expectDockArea(page: Page): Promise<void> {
  await expect(page.locator(".dv-dockview").first()).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Paneler" })).toHaveCount(0);
}

test("dock: ärendesidan visar telefonens flikrad eller iPadens dockyta, och en flik öppnas med ett tryck", async ({ page }) => {
  await openMatter(page);
  await (isPhone(page) ? expectPhoneTabs(page) : expectDockArea(page));
  const tab = page.getByRole("tab", { name: /^Dokument/ }).first();
  await tab.tap();
  await expect(tab).toHaveAttribute("aria-selected", "true");
});

/** Telefon: ☰ öppnas med ett tryck och leder till Ärenden. */
async function tapPhoneMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Öppna meny" }).tap();
  await page.getByRole("link", { name: /Ärenden/ }).first().tap();
}

/** iPad: ikonmenyn till vänster, ingen ☰, och ett tryck leder vidare. */
async function tapIconMenu(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Öppna meny" })).toHaveCount(0);
  const matters = page.getByRole("link", { name: "Ärenden / jävskontroll", exact: true });
  await expect(matters).toBeVisible();
  expect((await matters.boundingBox())?.x ?? 999, "ikonmenyn ligger längst till vänster").toBeLessThan(64);
  await matters.tap();
}

test("meny: ☰ på telefonen och ikonmenyn på iPad leder till Ärenden med ett tryck", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { name: "Startsida", level: 1 })).toBeVisible({ timeout: 30_000 });
  await (isPhone(page) ? tapPhoneMenu(page) : tapIconMenu(page));
  await expectMatters(page);
});

test("scroll: varken dokumentet eller main scrollar på ärendesidan, /matters/ och /time/", async ({ page }) => {
  await openMatter(page);
  expect(await pageScroll(page), "ärendesidan").toEqual({ doc: 0, main: 0 });
  for (const path of ["/matters/", "/time/"]) {
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    expect(await pageScroll(page), path).toEqual({ doc: 0, main: 0 });
  }
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });

  test("efter ett besök styr service workern sidan; offline laddas listan om och ett obesökt ärende öppnas", async ({ page, context }) => {
    const seed = await fetchDemoSeed(page, BASE);
    // Nyaste ärendet står på listans första sida (createdAt DESC).
    const [matter] = [...seed.matters].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    if (!matter) throw new Error("seeden saknar ärenden");
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/matters/`);
    await expectMatters(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });

    await context.setOffline(true);
    await page.reload();
    await expectMatters(page);
    await expect(page.getByText(matter.title).first()).toBeVisible({ timeout: 30_000 });
    await page.goto(`${BASE}/matters/${matter.id}/`);
    await expect(page.getByText(matter.title).first()).toBeVisible({ timeout: 30_000 });
    await context.setOffline(false);
  });
});
