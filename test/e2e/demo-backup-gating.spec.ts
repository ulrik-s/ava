/**
 * E2E (demo): backup på begäran (#1431) kräver en server med hostens
 * backupjobb och en administratör. Demon har ingen server — Inställningar
 * har varken panelen Backup eller knappen "Ta backup nu", och ingen begäran
 * eller nedladdning går iväg.
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("demon (ingen server): ingen Backup-panel och ingen 'Ta backup nu'", async ({ page }) => {
  const backupCalls: string[] = [];
  page.on("request", (req) => { if (/\/api\/(backup|trpc\/backup)/.test(req.url())) backupCalls.push(req.url()); });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/settings/`);
  // Dockytan har laddat: en annan panel i samma grupp går att visa.
  await showPanel(page, "Enheter och synk");
  await expect(page.getByText(/Varje webbläsare som synkar mot servern/)).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Backup$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ta backup nu" })).toHaveCount(0);
  await expect(page.getByTestId("backup-section")).toHaveCount(0);
  expect(backupCalls).toEqual([]);
});
