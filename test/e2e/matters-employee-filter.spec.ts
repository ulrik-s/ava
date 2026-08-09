/**
 * E2E: medarbetar-filter i ärendelistan.
 *
 * Dropdown högst upp i listan låter användaren visa alla ärenden ELLER
 * ärenden som en medarbetare har arbetat på (har tidsposter på). Verifierar
 * hela stacken: user.list fyller dropdown:en + valet filtrerar listan
 * (matter.list där timeEntries.some.userId).
 *
 * Kör mot lokalt serverad `out/` (default) eller mot live GH Pages:
 *   AVA_DEMO_BASE_URL=https://ulrik-s.github.io/ava npx playwright test matters-employee-filter
 */

import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test.beforeEach(async ({ page }) => {
  // localhost defaultar till self-hosted (→ 401) → tvinga demo. `repo: ""` ger
  // same-origin både lokalt och mot live (#932).
  await seedDemoLogin(page, BASE);
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
