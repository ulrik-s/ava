/**
 * E2E (demo): Enheter och synk (#1267). Översikten läses från servern och
 * finns bara för admin mot en server — i demon (ingen server) säger sidan det,
 * och Inställningar har panelen utan tabell. Synkrutorna står på Att åtgärda
 * (#1734), och där larmar ingen ruta.
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("demon (ingen server): sidan säger vem översikten är för, och Att åtgärda larmar inte", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/sync-devices/`);
  await expect(page.getByRole("heading", { name: "Enheter och synk" })).toBeVisible();
  await expect(page.getByText(/Översikten finns för administratörer/)).toBeVisible();
  await expect(page.getByTestId("sync-devices")).toHaveCount(0);

  await page.goto(`${BASE}/action-items/`);
  await expect(page.getByRole("heading", { name: "Att åtgärda" }).first()).toBeVisible();
  await expect(page.getByTestId("stale-devices-notice")).toHaveCount(0);
  await expect(page.getByTestId("rejected-changes-notice")).toHaveCount(0);
});

test("Inställningar har panelen Enheter och synk", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/settings/`);
  await showPanel(page, "Enheter och synk");
  await expect(page.getByText(/Varje webbläsare som synkar mot servern/)).toBeVisible();
});
