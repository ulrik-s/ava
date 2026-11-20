/**
 * E2E (demo): huvudmenyn nås i smala fönster (#1297, #1301).
 *
 * - Telefon (under 768 px): toppremsa med "Öppna meny" (☰). Temaknappen låg
 *   förr ovanpå menyknappen och tog emot klicket, och toppremsan låg `fixed`
 *   ovanpå statusraden och demobannern (#1297).
 * - 768–1023 px (en halv skärm i en tiling-fönsterhanterare, surfplatta): en
 *   ikonmeny till vänster, alltid synlig (#1301). Förr fanns bara ☰ uppe till
 *   höger, och menyn "syntes inte till vänster".
 * - AVA:s version (#1578) står bara i den utfällda desktopmenyns nedre del,
 *   vid användarens namn (#1749). Den bakas in vid bygget ur
 *   `git describe --tags`; förväntad text räknas fram ur samma utcheckning.
 *   Saknar den taggar (grund klon) visas ingenting.
 * - Startsidan nås med en rund knapp bredvid "AVA" i alla varianter (#1749),
 *   inte som menyval i listan.
 */
import type { Locator, Page } from "@playwright/test";
import { formatAppVersion } from "../../src/lib/shared/app-version";
import { readBuildVersion } from "../../tooling/scripts/build-version";
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

const build = readBuildVersion();
const VERSION_TEXT = formatAppVersion(build.version, build.date);
const versionText = (page: Page) => page.locator("[data-app-version]");

/** Ligger elementet själv överst i sin mittpunkt (inget annat täcker det)? */
async function isTopmost(page: Page, role: "button" | "link", name: string | RegExp): Promise<boolean> {
  const el = page.getByRole(role, typeof name === "string" ? { name, exact: true } : { name }).first();
  await expect(el).toBeVisible();
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === node || node.contains(hit));
  });
}

/** Inget täcker temaknappen eller demobannrarnas länkar. */
async function expectNothingCovered(page: Page, extra: ReadonlyArray<readonly ["button" | "link", string]> = []): Promise<void> {
  await expect(page.getByRole("button", { name: "Byt till mörkt läge" })).toHaveCount(1);
  for (const [role, name] of [...extra, ["button", "Byt till mörkt läge"], ["link", /Inställningar$/], ["button", "Återställ demo"], ["button", "Stäng demo-banner"]] as const) {
    expect(await isTopmost(page, role, name), `${String(name)} ska inte täckas`).toBe(true);
  }
}

async function openStart(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { name: "Startsida", level: 1 })).toBeVisible({ timeout: 30_000 });
}

async function expectMatters(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/matters\/?$/);
  await expect(page.getByRole("heading", { name: "Ärenden / jävskontroll", level: 1, exact: true })).toBeVisible();
}

test("telefon (390×844): ☰ öppnar menyn och leder vidare från startsidan", async ({ page }) => {
  await openStart(page, 390, 844);
  const menu = page.getByRole("button", { name: "Öppna meny" });
  await expect(menu).toBeVisible();
  await expectNothingCovered(page, [["button", "Öppna meny"]]);
  await menu.click();
  await page.getByRole("link", { name: /Ärenden/ }).first().click();
  await expectMatters(page);
});

for (const [label, width, height] of [["halv skärm", 800, 900], ["kvarts skärm", 1000, 600]] as const) {
  test(`${label} (${width}×${height}): ikonmenyn till vänster syns och leder vidare`, async ({ page }) => {
    await openStart(page, width, height);
    await expect(page.getByRole("button", { name: "Öppna meny" })).toHaveCount(0);

    const matters = page.getByRole("link", { name: "Ärenden / jävskontroll", exact: true });
    await expect(matters).toBeVisible();
    const box = await matters.boundingBox();
    expect(box?.x ?? 999, "ikonmenyn ligger längst till vänster").toBeLessThan(64);
    expect(box?.width ?? 999, "bara ikoner — smal meny").toBeLessThanOrEqual(64);
    await expectNothingCovered(page, [["link", "Ärenden / jävskontroll"]]);

    await matters.click();
    await expectMatters(page);
  });
}

test("1280 px: 64 px-huvudet utan version; versionen står nere vid namnet, inte efter Fäll ihop (#1578, #1749)", async ({ page }) => {
  await openStart(page, 1280, 800);
  const header = page.locator("[data-desktop-sidebar] > div").first();
  expect((await header.boundingBox())?.height).toBe(64);
  await expect(header.locator("[data-app-version]")).toHaveCount(0);
  await expect(header).not.toContainText("Advokat CRM");
  await expect(versionText(page)).toHaveCount(VERSION_TEXT ? 1 : 0);
  if (VERSION_TEXT) {
    await expect(versionText(page)).toHaveText(VERSION_TEXT);
    await expect(page.locator("[data-desktop-sidebar] [data-user-info] [data-app-version]")).toBeVisible();
  }
  await page.getByRole("button", { name: "Fäll ihop menyn" }).click();
  await expect(page.getByRole("button", { name: "Fäll ut menyn" })).toBeVisible();
  await expect(versionText(page)).toHaveCount(0);
});

test("900 px (ikonmenyn): ingen synlig versionstext (#1578)", async ({ page }) => {
  await openStart(page, 900, 900);
  await expect(page.getByRole("link", { name: "Ärenden / jävskontroll", exact: true })).toBeVisible();
  await expect(versionText(page)).toBeHidden();
});

test("390 px (telefon): ingen versionstext i toppremsan eller den öppnade menyn (#1578)", async ({ page }) => {
  await openStart(page, 390, 844);
  await expect(versionText(page)).toBeHidden();
  await page.getByRole("button", { name: "Öppna meny" }).click();
  await expect(page.getByRole("link", { name: /Ärenden/ }).first()).toBeVisible();
  await expect(versionText(page)).toBeHidden();
});

/** Knappen leder från /matters till Startsidan, och menylistan saknar menyvalet. */
async function expectHomeButtonWorks(page: Page): Promise<void> {
  const nav = page.locator("nav:visible");
  await expect(nav.getByRole("link", { name: /Ärenden/ }).first()).toBeVisible();
  await expect(nav.getByRole("link", { name: /Startsida/ })).toHaveCount(0);
  await page.goto(`${BASE}/matters/`);
  await expectMatters(page);
  const home = page.getByRole("link", { name: /Startsida/ });
  await expect(home).toHaveCount(1);
  await expect(home).not.toHaveAttribute("aria-current", "page");
  await home.click();
  await expect(page.getByRole("heading", { name: "Startsida", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Startsida/ })).toHaveAttribute("aria-current", "page");
}

type Box = { x: number; y: number; width: number; height: number };

/** Skär rutorna varandra? */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxOf(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("elementet syns inte");
  return b;
}

/** "AVA", knappen och växlingsknappen överlappar inte och klipps inte av huvudet. */
async function expectHeaderFits(page: Page, toggle: string): Promise<void> {
  const header = page.locator("[data-desktop-sidebar] > div").first();
  const box = await boxOf(header);
  const ava = await boxOf(header.getByRole("heading", { name: "AVA" }));
  const home = await boxOf(header.getByRole("link", { name: /Startsida/ }));
  const btn = await boxOf(header.getByRole("button", { name: toggle }));
  expect(overlaps(home, ava), "knappen överlappar inte AVA").toBe(false);
  expect(overlaps(home, btn), "knappen överlappar inte växlingsknappen").toBe(false);
  for (const b of [ava, home, btn]) {
    expect(b.x + b.width, "inget klipps till höger").toBeLessThanOrEqual(box.x + box.width);
    expect(b.y + b.height, "inget klipps nedtill").toBeLessThanOrEqual(box.y + box.height);
  }
}

test("1280 px utfälld: Startsida-knappen med text i 64 px-huvudet leder till Startsida (#1749)", async ({ page }) => {
  await openStart(page, 1280, 800);
  await expectHeaderFits(page, "Fäll ihop menyn");
  await expect(page.getByRole("link", { name: /Startsida/ })).toHaveText("Startsida");
  await expectHomeButtonWorks(page);
});

test("1280 px hopfälld: Startsida-knappen bara ikon, inget klipps, ingen versionstext (#1749)", async ({ page }) => {
  await openStart(page, 1280, 800);
  await page.getByRole("button", { name: "Fäll ihop menyn" }).click();
  await expectHeaderFits(page, "Fäll ut menyn");
  await expect(page.getByRole("link", { name: "Startsida" })).toHaveAttribute("title", "Startsida");
  await expect(versionText(page)).toHaveCount(0);
  await expectHomeButtonWorks(page);
});

test("900 px (ikonmenyn): Startsida-knappen syns och leder till Startsida (#1749)", async ({ page }) => {
  await openStart(page, 900, 900);
  await expect(page.locator("[data-icon-sidebar]").getByRole("link", { name: "Startsida" })).toBeVisible();
  await expectHomeButtonWorks(page);
});

test("390 px (telefon): Startsida-knappen i toppremsan, inget täcks, leder till Startsida (#1749)", async ({ page }) => {
  await openStart(page, 390, 844);
  await expectNothingCovered(page, [["button", "Öppna meny"], ["link", "Startsida"]]);
  await expect(page.locator("div[data-mobile-topbar]")).not.toContainText("Advokat CRM");
  await page.goto(`${BASE}/matters/`);
  await expectMatters(page);
  await page.getByRole("button", { name: "Öppna meny" }).click();
  const drawer = page.locator(".fixed.inset-0 nav");
  await expect(drawer.getByRole("link", { name: /Ärenden/ })).toBeVisible();
  await expect(drawer.locator(".overflow-y-auto").getByRole("link", { name: /Startsida/ })).toHaveCount(0);
  await drawer.getByRole("link", { name: /Startsida/ }).click();
  await expect(page.getByRole("heading", { name: "Startsida", level: 1 })).toBeVisible({ timeout: 30_000 });
});
