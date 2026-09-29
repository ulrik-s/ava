/**
 * E2E (demo): kostnadsräkningen i en undermapp hittas (#1308).
 *
 * KR-dokumentet filas i `/Domstol/Kostnadsräkningar` (#985). Invarianten och
 * KR-länken i Fakturering läste bara ärendets rotmapp. Det gav ett falsklarm i
 * "Rapportera fel" ("inget Kostnadsräkning-dokument"), och KR-referensen blev
 * inte en länk till dokumentet.
 */
import { DEMO_BASE_URL as BASE, fetchDemoSeed, matterWithKrStatus, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("KR som väntar på dom: inget självupptäckt fel, och referensen öppnar dokumentet", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, BASE);
  const seed = await fetchDemoSeed(page, BASE);
  const matterId = matterWithKrStatus(seed, "INSKICKAD");

  await page.goto(`${BASE}/matters/${matterId}/`);
  await showPanel(page, "Fakturering");
  const krLink = page.getByRole("button", { name: /^KR-\d{4}-\d{4}$/ });
  await expect(krLink).toBeVisible({ timeout: 30_000 });

  // Invarianten har kört när dokumentlistan är laddad (länken ovan bygger på den).
  await page.waitForTimeout(1000);
  await expect(page.getByLabel(/självupptäckta fel/)).toHaveCount(0);
});
