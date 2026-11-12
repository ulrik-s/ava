/**
 * E2E (demo): visningsfel från genomgången av alla menyer (#1309).
 *
 * - Anteckningar: rå ISO-tidpunkt i Datum (demogeneratorn skickade den som `date`).
 * - Fakturor: typen "CREDIT" i stället för "Kreditfaktura".
 * - Avbetalningar: radens status "AKTIVA" (filterknappens plural).
 * - Användare: "2.50 kr/km" med decimalpunkt; nu kr/mil med decimalkomma (#1527).
 * - Kalender: "Tasks" / "Ny task".
 * - Fakturor: annullerade och kreditfakturor dolda från början (#1522).
 * - Ärendet: fliken Betalningssätt borta, ändras via huvudet (#1499).
 */
import { DEMO_BASE_URL as BASE, fetchDemoSeed, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, BASE);
});

test("ärendenas anteckningar visar dag och klockslag, aldrig en rå ISO-tidpunkt", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  // Ärenden med fakturor har anteckningar från fakturaflödet och generatorn.
  const matterIds = [...new Set(seed.invoices.map((i) => i.matterId))].slice(0, 4);
  for (const id of matterIds) {
    await page.goto(`${BASE}/matters/${id}/`);
    await showPanel(page, "Anteckningar");
    const notes = page.getByRole("heading", { name: "Tjänsteanteckningar" }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(notes.getByRole("row").nth(1)).toBeVisible({ timeout: 30_000 });
    expect(await notes.innerText(), id).not.toMatch(ISO_TIMESTAMP);
  }
});

test("Fakturor, Avbetalningar, Användare och Kalender visar svenska etiketter", async ({ page }) => {
  await page.goto(`${BASE}/invoices/`);
  // Kreditfakturor är dolda från början (#1522).
  await page.getByRole("button", { name: /^Visa annullerade \(\d+\)$/ }).click({ timeout: 30_000 });
  await expect(page.getByText("Kreditfaktura").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("CREDIT", { exact: true })).toHaveCount(0);

  await page.goto(`${BASE}/payment-plans/`);
  await expect(page.getByRole("cell", { name: "Aktiv", exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`${BASE}/users/`);
  await expect(page.getByText(/^\d+,\d{2}\s?kr\/mil$/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d\.\d{2}\s?kr\/mil|kr\/km/)).toHaveCount(0);

  await page.goto(`${BASE}/calendar/`);
  await showPanel(page, "Uppgifter");
  await expect(page.getByRole("heading", { name: "Uppgifter", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ny uppgift/ })).toBeVisible();
});

// Betalningssättet i ärendehuvudet (#1518): etikett, försäkringsbolag (vid
// rättsskydd) och klientens andel, på raden under titeln.
const PAYMENT_LINES = [
  // Rättsskydd där försäkringsbolaget är motpart: inget bolag visas, ingen andel satt.
  { matterNumber: "2026-0012", text: "· Rättsskydd" },
  // Rättsskydd, självrisk 20 %, inget försäkringsbolag som kontakt.
  { matterNumber: "2026-0021", text: "· Rättsskydd · klienten betalar 20 %" },
  // Rättshjälp med 40 % klientandel.
  { matterNumber: "2026-0010", text: "· Rättshjälp · klienten betalar 40 %" },
] as const;

for (const { matterNumber, text } of PAYMENT_LINES) {
  test(`ärendehuvudet visar betalningssättet: ${text}`, async ({ page }) => {
    const seed = await fetchDemoSeed(page, BASE);
    const matter = seed.matters.find((m) => m.matterNumber === matterNumber);
    expect(matter, matterNumber).toBeDefined();
    await page.goto(`${BASE}/matters/${matter?.id ?? ""}/`);
    await expect(page.getByTestId("matter-payment-line")).toHaveText(text, { timeout: 30_000 });
  });
}

// Fliken Betalningssätt är borta (#1499): "Ändra" i huvudet öppnar ärendedialogen (#1565).
test("ingen flik Betalningssätt; betalningssättet ändras via ärendehuvudet (#1499)", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  const matter = seed.matters.find((m) => m.matterNumber === "2026-0010");
  expect(matter).toBeDefined();
  await page.goto(`${BASE}/matters/${matter?.id ?? ""}/`);
  const line = page.getByTestId("matter-payment-line");
  await expect(line).toHaveText("· Rättshjälp · klienten betalar 40 %", { timeout: 30_000 });
  await expect(page.getByRole("tab", { name: /^Tid/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Betalningssätt/ })).toHaveCount(0);

  await page.getByTestId("matter-header").getByRole("button", { name: "Ändra ärende" }).click();
  const dialog = page.getByRole("dialog", { name: "Ändra ärende" });
  await dialog.getByLabel("Betalningssätt", { exact: true }).selectOption("PRIVAT");
  await dialog.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(line).toHaveText("· Privat betalning", { timeout: 15_000 });
});

test("Fakturor döljer annullerade och kreditfakturor tills man väljer att visa dem (#1522)", async ({ page }) => {
  await page.goto(`${BASE}/invoices/`);
  const show = page.getByRole("button", { name: /^Visa annullerade \(\d+\)$/ });
  await expect(show).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: "Kreditfaktura", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Annullerad", exact: true })).toHaveCount(0);

  await show.click();
  await expect(page.getByRole("cell", { name: "Kreditfaktura", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Dölj annullerade" }).click();
  await expect(page.getByRole("cell", { name: "Kreditfaktura", exact: true })).toHaveCount(0);
});
