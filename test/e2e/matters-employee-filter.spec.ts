/**
 * E2E: medarbetar-filter i ärendelistan.
 *
 * Dropdown högst upp i listan låter användaren visa alla ärenden ELLER
 * ärenden som en medarbetare har arbetat på (har tidsposter på). Verifierar
 * hela stacken: user.list fyller dropdown:en + valet filtrerar listan
 * (matter.list där timeEntries.some.userId).
 *
 * Kör mot live GH Pages (default) eller lokalt demo-bygge:
 *   AVA_DEMO_BASE_URL=http://localhost:8099/ava npx playwright test matters-employee-filter
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.AVA_DEMO_BASE_URL ?? "https://ulrik-s.github.io/ava";
const isLocal = /localhost|127\.0\.0\.1/.test(BASE);

test.beforeEach(async ({ page }) => {
  if (!isLocal) return;
  await page.addInitScript((origin) => {
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "demo", repo: origin, token: "",
      organizationId: "demo-firma-ab", authorName: "AVA Demo", authorEmail: "demo@ava.local",
    }));
  }, BASE);
});

test("medarbetar-dropdown fylls och filtrerar ärendelistan", async ({ page }) => {
  await page.goto(`${BASE}/matters/`);
  await page.locator("table tbody tr").first().waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1500);

  const dropdown = page.locator('select[title*="medarbetaren"]');
  await expect(dropdown).toBeVisible();

  // Default-alternativ + minst en medarbetare
  await expect(dropdown.locator("option")).not.toHaveCount(1);
  await expect(dropdown.locator("option").first()).toHaveText("Alla medarbetare");

  const allCount = await page.locator("table tbody tr").count();
  expect(allCount).toBeGreaterThan(0);

  // Välj första medarbetaren → listan ska filtreras till en delmängd
  const firstEmployee = await dropdown.locator("option").nth(1).getAttribute("value");
  await dropdown.selectOption(firstEmployee!);
  await page.waitForTimeout(1500);

  const filteredCount = await page.locator("table tbody tr").count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(filteredCount).toBeLessThanOrEqual(allCount);

  // Tillbaka till "Alla medarbetare" återställer
  await dropdown.selectOption("");
  await page.waitForTimeout(1000);
  expect(await page.locator("table tbody tr").count()).toBe(allCount);
});
