/**
 * E2E (demo): Rapporter visar advokatrapporten för förvald advokat och period (#1303).
 *
 * I demon lagras datum som ISO-strängar (lagret laddas från JSON). Rapporten
 * kraschade då (`getUTCFullYear is not a function`), och panelerna visade
 * "Välj jurist och period." fast både advokat och period var valda.
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("förvald advokat och period → Sammanfattning och Veckor visar rapporten", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/reports/`);
  await expect(page.getByRole("heading", { name: "Rapporter", level: 1 })).toBeVisible({ timeout: 30_000 });

  const lawyer = page.getByLabel("Advokat", { exact: true });
  await expect(lawyer).not.toHaveValue("");
  const lawyerName = (await lawyer.locator("option:checked").textContent()) ?? "";

  // Sammanfattningen: advokatens namn och totaltiden.
  await expect(page.getByText("Totalt tid", { exact: true })).toBeVisible();
  await expect(page.getByText(lawyerName, { exact: true }).last()).toBeVisible();

  // Veckotabellen (flik bredvid Ärenden).
  await showPanel(page, "Veckor");
  await expect(page.getByText(/Timdebitering per vecka/)).toBeVisible();

  await expect(page.getByText("Välj jurist och period.")).toHaveCount(0);
  await expect(page.getByText(/Rapporten kunde inte hämtas/)).toHaveCount(0);
});
