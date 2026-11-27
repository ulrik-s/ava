/**
 * E2E (demo): kostnadsräkningen i en undermapp hittas (#1308).
 *
 * KR-dokumentet filas i `/Domstol/Kostnadsräkningar` (#985). Invarianten och
 * KR-länken i Fakturering läste bara ärendets rotmapp. Det gav ett falsklarm i
 * "Rapportera fel" ("inget Kostnadsräkning-dokument"), och KR-referensen blev
 * inte en länk till dokumentet.
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, type DemoSeed, fetchDemoSeed, matterWithKrStatus, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

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

  // #1976: + Ladda upp går genom samma namnruta, och den valda mappen gäller.
  test("+ Ladda upp öppnar namnrutan och sparar i den valda mappen", async ({ page }) => {
    await page.locator("input[type=file]").setInputFiles({ name: "yttrande.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    await expect(dialog.getByRole("textbox")).toHaveValue("yttrande");
    await dialog.getByLabel("Mapp").selectOption({ label: "Domstol" });
    await dialog.getByRole("textbox").fill("Yttrande över bevisning");
    await dialog.getByRole("button", { name: "Spara" }).click();
    const saved = page.getByText("Yttrande över bevisning.pdf");
    await expect(saved).toBeVisible({ timeout: 30_000 });
    // Raden ligger under Domstol: indragen (djup 1), inte i roten.
    await expect(page.locator("tr").filter({ has: saved }).locator("[style*='padding-left: 20px']").first()).toBeVisible();
  });

  test("ett mejl som .eml släppt på roten förifylls med ämnesraden och sparas som .eml (#1616)", async ({ page }) => {
    await dropFile(page, "Rot", "mejl.eml", "message/rfc822", "Subject: =?UTF-8?Q?M=C3=B6te_om_f=C3=B6rlikning?=\r\n\r\nText");
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    await expect(dialog.getByRole("textbox")).toHaveValue("Möte om förlikning");
    await dialog.getByRole("button", { name: "Spara" }).click();
    await expect(page.getByText("Möte om förlikning.eml")).toBeVisible({ timeout: 30_000 });
  });

  // #1975: utan släppmål föreslår rutan en mapp ur namnet (här mejlets ämnesrad).
  test("ett mejl med en kallelse släppt på roten föreslår Domstol › Kallelse och sparas där", async ({ page }) => {
    await dropFile(page, "Rot", "x7f3.eml", "message/rfc822", "Subject: Kallelse till huvudförhandling\r\n\r\nText");
    const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
    await expect(dialog.getByRole("textbox")).toHaveValue("Kallelse till huvudförhandling");
    await expect(dialog.getByLabel("Mapp").locator("option:checked")).toHaveText("Domstol › Kallelse");
    await dialog.getByRole("button", { name: "Spara" }).click();
    const saved = page.getByText("Kallelse till huvudförhandling.eml");
    await expect(saved).toBeVisible({ timeout: 30_000 });
    // Raden ligger under Domstol › Kallelse: djup 2.
    await expect(page.locator("tr").filter({ has: saved }).locator("[style*='padding-left: 36px']").first()).toBeVisible();
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

/** Demons mappar ur seeden (#2045); `DemoSeed` tar inte med dem. */
async function fetchDocumentFolders(page: Page): Promise<Array<{ matterId: string; name: string; parentId: string | null }>> {
  const res = await page.request.get(`${BASE}/demo-seed.json`);
  const body: { documentFolders?: Array<{ matterId: string; name: string; parentId: string | null }> } = await res.json();
  return body.documentFolders ?? [];
}

// #2045: ett dokument flyttas till en mapp i ett annat ärende med dokumentmenyns
// Flytta till ärende…. Det syns där, i mappen, och inte längre i det gamla.
// Ligger här eftersom demo-konfigurationens testMatch (skyddad) listar filerna.
test("Flytta till ärende… flyttar dokumentet till en mapp i ett annat ärende", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, BASE);
  const seed = await fetchDemoSeed(page, BASE);
  const from = matterWithKrStatus(seed, "INSKICKAD");
  const docs = seed.documents as Array<DemoSeed["documents"][number] & { invoiceId?: string | null }>;
  const folders = await fetchDocumentFolders(page);
  const hasTitle = (matterId: string, title: string) => docs.some((d) => d.matterId === matterId && d.title === title);
  const movable = docs.filter((d) => d.matterId === from && !d.billingRunId && !d.invoiceId);
  // Målet: ett aktivt ärende med mappen Korrespondens överst och inget dokument med samma titel.
  const pick = movable.flatMap((d) => seed.matters
    .filter((m) => m.id !== from && m.status === "ACTIVE" && !hasTitle(m.id, d.title)
      && folders.some((f) => f.matterId === m.id && f.name === "Korrespondens" && f.parentId === null))
    .flatMap((m) => (m.matterNumber ? [{ doc: d, to: { ...m, matterNumber: m.matterNumber } }] : [])))[0];
  const doc = pick?.doc;
  const to = pick?.to;
  if (!doc || !to) throw new Error("seeden saknar ett flyttbart dokument eller ett aktivt ärende med mappen Korrespondens");

  await page.goto(`${BASE}/matters/${from}/`);
  await showPanel(page, "Dokument");
  await page.getByRole("button", { name: "Mapp-vy", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: doc.title });
  await row.getByLabel("Dokumentåtgärder").click();
  await page.getByRole("menuitem", { name: /Flytta till ärende…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Flytta till ärende" });
  await dialog.getByLabel("1 dokument flyttas till:").fill(`${to.matterNumber} — ${to.title}`);
  await expect(dialog.getByLabel("Mapp").locator("option:checked")).toHaveText("Överst, utan mapp");
  await dialog.getByLabel("Mapp").selectOption({ label: "Korrespondens" });
  await dialog.getByRole("button", { name: "Flytta" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0, { timeout: 30_000 });

  await page.goto(`${BASE}/matters/${to.id}/`);
  await showPanel(page, "Dokument");
  await page.getByRole("button", { name: "Mapp-vy", exact: true }).click();
  const moved = page.getByRole("row").filter({ hasText: doc.title });
  await expect(moved).toBeVisible({ timeout: 30_000 });
  // Raden ligger under Korrespondens: indragen (djup 1), inte i roten.
  await expect(moved.locator("[style*='padding-left: 20px']").first()).toBeVisible();
});
