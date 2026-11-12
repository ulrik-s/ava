/**
 * E2E (demo, #1542): registrerad tid visas i decimaltimmar med svenskt
 * decimalkomma, aldrig som H:MM, och kolumnrubriken bär enheten "h".
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

const H_MM = /^\d+:\d\d$/;

test("tidssidan visar registrerad tid i decimaltimmar", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/time/`);
  await expect(page.getByText(/^Totalt: \d[\d\s]*(,\d{1,2})? h$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("columnheader", { name: /^Tid \(h\)/ })).toBeVisible();

  const cells = page.locator("tbody td span.font-mono");
  await expect(cells.first()).toBeVisible({ timeout: 30_000 });
  const values = await cells.allInnerTexts();
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v).not.toMatch(H_MM);
    expect(v).toMatch(/^\d[\d\s]*(,\d{1,2})?$/);
  }
});
