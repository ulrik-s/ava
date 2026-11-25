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
// Ett mejl förifylls med sin ämnesrad (#1616).
// Specen ligger här eftersom demo-konfigurationens testMatch (skyddad) bara
// plockar upp listade filer; den rör dokumentmappar, precis som KR-fallet.
test.describe("släpp filer utifrån i dokumentvyn (#1615)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seedDemoLogin(page, BASE);
    const seed = await fetchDemoSeed(page, BASE);
    await page.goto(`${BASE}/matters/${matterWithKrStatus(seed, "INSKICKAD")}/`);
    await showPanel(page, "Dokument");
    await page.getByRole("button", { name: "Mapp-vy", exact: true }).click();
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

  // #1974: rutan visar släppmålet i Mapp, och en annan vald mapp gäller vid Spara.
  test("en PDF släppt på en mapp visar mappen i Mapp, och en annan vald mapp gäller", async ({ page }) => {
    await dropFile(page, "Domstol", "kallelse.pdf", "application/pdf", "%PDF-1.4\n%%EOF");
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    const folder = dialog.getByLabel("Mapp");
    await expect(folder.locator("option:checked")).toHaveText("Domstol");
    await folder.selectOption({ label: "Domstol › Kallelse" });
    await dialog.getByRole("textbox").fill("Kallelse till huvudförhandling");
    await dialog.getByRole("button", { name: "Spara" }).click();
    const saved = page.getByText("Kallelse till huvudförhandling.pdf");
    await expect(saved).toBeVisible({ timeout: 30_000 });
    // Raden ligger under Domstol › Kallelse: djup 2, inte direkt under Domstol.
    await expect(page.locator("tr").filter({ has: saved }).locator("[style*='padding-left: 36px']").first()).toBeVisible();
  });

  test("ett mejl som .eml släppt på roten förifylls med ämnesraden och sparas som .eml (#1616)", async ({ page }) => {
    await dropFile(page, "Rot", "mejl.eml", "message/rfc822", "Subject: =?UTF-8?Q?M=C3=B6te_om_f=C3=B6rlikning?=\r\n\r\nText");
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    await expect(dialog.getByRole("textbox")).toHaveValue("Möte om förlikning");
    await dialog.getByRole("button", { name: "Spara" }).click();
    await expect(page.getByText("Möte om förlikning.eml")).toBeVisible({ timeout: 30_000 });
  });
});

// #1753: dokumentträdets rader är toppjusterade. Klassen sitter på <tr>, och
// cellerna ärver justeringen i en riktig webbläsare (td { vertical-align: inherit }).
test("dokumentträdet: cellerna i mapp- och dokumentrader börjar längst upp", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, BASE);
  const seed = await fetchDemoSeed(page, BASE);
  await page.goto(`${BASE}/matters/${matterWithKrStatus(seed, "INSKICKAD")}/`);
  await showPanel(page, "Dokument");
  await page.getByRole("button", { name: "Mapp-vy", exact: true }).click();
  await expect(page.getByText("Rot", { exact: true })).toBeVisible({ timeout: 30_000 });

  const folderRow = page.locator("tr").filter({ has: page.getByText("Domstol", { exact: true }) }).first();
  const documentRow = page.locator("tr").filter({ has: page.getByLabel("Dokumentåtgärder") }).first();
  for (const row of [folderRow, documentRow]) {
    await expect(row).toBeVisible();
    expect(await row.locator("td").first().evaluate((td) => getComputedStyle(td).verticalAlign)).toBe("top");
  }
});
