/**
 * E2E (demo): huvudmenyn går att öppna i smala fönster (#1297).
 *
 * Under 1024 px ersätts sidomenyn av en toppremsa med "Öppna meny" (☰) längst
 * till höger. Temaknappen låg fast på samma plats, ovanpå menyknappen, och tog
 * emot klicket — i en tiling-fönsterhanterare (och på telefon) gick menyn inte
 * att öppna, och man satt fast på startsidan. Toppremsan låg dessutom `fixed`
 * ovanpå statusraden och demobannern, så "Inställningar", "Återställ demo" och
 * bannerns × gick inte att nå.
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

for (const [label, width, height] of [["telefon", 390, 844], ["halv skärm", 800, 900], ["kvarts skärm", 1000, 600]] as const) {
  test(`${label} (${width}×${height}): menyn öppnas och leder vidare från startsidan`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/`);
    const menu = page.getByRole("button", { name: "Öppna meny" });
    await expect(menu).toBeVisible({ timeout: 30_000 });

    // Inget täcker menyknappen, temaknappen eller demobannrarnas länkar.
    await expect(page.getByRole("button", { name: "Byt till mörkt läge" })).toHaveCount(1);
    for (const [role, name] of [["button", "Öppna meny"], ["button", "Byt till mörkt läge"], ["link", /Inställningar$/], ["button", "Återställ demo"], ["button", "Stäng demo-banner"]] as const) {
      expect(await isTopmost(page, role, name), `${String(name)} ska inte täckas`).toBe(true);
    }

    await menu.click();
    await page.getByRole("link", { name: /Ärenden/ }).first().click();
    await expect(page).toHaveURL(/\/matters\/?$/);
    await expect(page.getByRole("heading", { name: "Ärenden", level: 1 })).toBeVisible();
  });
}
