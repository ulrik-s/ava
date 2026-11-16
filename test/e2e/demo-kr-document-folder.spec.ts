/**
 * E2E (demo): kostnadsräkningen i en undermapp hittas (#1308).
 *
 * KR-dokumentet filas i `/Domstol/Kostnadsräkningar` (#985). Invarianten och
 * KR-länken i Fakturering läste bara ärendets rotmapp. Det gav ett falsklarm i
 * "Rapportera fel" ("inget Kostnadsräkning-dokument"), och KR-referensen blev
 * inte en länk till dokumentet.
 */
import type { Page } from "@playwright/test";
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

// #1615: filer som släpps utifrån i dokumentvyn — på en mapp eller på roten —
// går via namnrutan och sparas som de filer de är (PDF som PDF, .eml som .eml).
// Specen ligger här eftersom demo-konfigurationens testMatch (skyddad) bara
// plockar upp listade filer; den rör dokumentmappar, precis som KR-fallet.
test.describe("släpp filer utifrån i dokumentvyn (#1615)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seedDemoLogin(page, BASE);
    const seed = await fetchDemoSeed(page, BASE);
    await page.goto(`${BASE}/matters/${matterWithKrStatus(seed, "INSKICKAD")}/`);
    await showPanel(page, "Dokument");
    await page.getByRole("button", { name: "Träd", exact: true }).click();
    await expect(page.getByText("Rot", { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  /** Skicka dragenter/dragover/drop med en syntetisk fil till raden som innehåller `rowText`. */
  async function dropFile(page: Page, rowText: string, name: string, type: string, body: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name, type, body }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([body], name, { type }));
      return dt;
    }, { name, type, body });
    const row = page.locator("tr").filter({ has: page.getByText(rowText, { exact: true }) }).first();
    for (const event of ["dragenter", "dragover", "drop"]) await row.dispatchEvent(event, { dataTransfer });
  }

  test("en PDF släppt på en mapp sparas i mappen med det valda namnet", async ({ page }) => {
    await dropFile(page, "Domstol", "bilaga.pdf", "application/pdf", "%PDF-1.4\n%%EOF");
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    await expect(dialog.getByRole("textbox")).toHaveValue("bilaga");
    await dialog.getByRole("textbox").fill("Bilaga till inlaga");
    await dialog.getByRole("button", { name: "Spara" }).click();
    const saved = page.getByText("Bilaga till inlaga.pdf");
    await expect(saved).toBeVisible({ timeout: 30_000 });
    // Raden ligger under Domstol: indragen (djup 1), inte i roten.
    await expect(page.locator("tr").filter({ has: saved }).locator("[style*='padding-left: 20px']").first()).toBeVisible();
  });

  test("ett mejl som .eml släppt på roten sparas som .eml", async ({ page }) => {
    await dropFile(page, "Rot", "mejl.eml", "message/rfc822", "Subject: Hej\r\n\r\nText");
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    await expect(dialog.getByRole("textbox")).toHaveValue("mejl");
    await dialog.getByRole("button", { name: "Spara" }).click();
    await expect(page.getByText("mejl.eml")).toBeVisible({ timeout: 30_000 });
  });
});
