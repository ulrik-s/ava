/**
 * E2E (demo): huvudmenyn nås i smala fönster (#1297, #1301).
 *
 * - Telefon (under 768 px): toppremsa med "Öppna meny" (☰). Temaknappen låg
 *   förr ovanpå menyknappen och tog emot klicket, och toppremsan låg `fixed`
 *   ovanpå statusraden och demobannern (#1297).
 * - 768–1023 px (en halv skärm i en tiling-fönsterhanterare, surfplatta): en
 *   ikonmeny till vänster, alltid synlig (#1301). Förr fanns bara ☰ uppe till
 *   höger, och menyn "syntes inte till vänster".
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

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
  await expect(page.getByRole("heading", { name: "Ärenden", level: 1 })).toBeVisible();
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

    const matters = page.getByRole("link", { name: "Ärenden", exact: true });
    await expect(matters).toBeVisible();
    const box = await matters.boundingBox();
    expect(box?.x ?? 999, "ikonmenyn ligger längst till vänster").toBeLessThan(64);
    expect(box?.width ?? 999, "bara ikoner — smal meny").toBeLessThanOrEqual(64);
    await expectNothingCovered(page, [["link", "Ärenden"]]);

    await matters.click();
    await expectMatters(page);
  });
}
