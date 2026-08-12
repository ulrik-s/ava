/**
 * E2E (demo): kostnadsräkningens väg från "väntar på dom" till faktura.
 *
 *   Ärendet vars KR väntar på dom → "Registrera beslut" (dömt belopp + prutning)
 *   → "Skapa faktura" → domstolsfakturan finns, med sitt fakturadokument.
 *
 * Flödet är TVÅ steg, inte ett: servern läser prutningen ur beslutet, så
 * verdict-dialogen bekräftar bara att fakturan ska skapas.
 *
 * Varför en egen spec (#996): `demo-invoice-document.spec.ts` hade en gren som
 * skulle köra den här vägen, men letade efter en knapp `Ange dom + prutning` —
 * en etikett som bara fanns i `BILLING_FLOWS.pendingBanner` och aldrig
 * renderades av något. Grenen var villkorad (`if (count())`) och hoppades
 * därför tyst över vid varje körning. Här är den ovillkorlig: hittas inte
 * knappen FALLER testet.
 *
 * Ärendet slås upp ur seeden — vilket brottmål som står kvar i väntan bestäms
 * av scenariodispatchern (#882), inte av den här filen.
 */

import { DEMO_BASE_URL, fetchDemoSeed, matterWithKrStatus, seedDemoLogin, test, expect } from "./_demo-test";

/** Belopp domstolen dömer ut respektive prutar, i kronor. */
const AWARDED_KR = 12_000;
const PRUTNING_KR = 1_500;

test("kostnadsräkning som väntar på dom: registrera beslut → skapa faktura", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);

  const seed = await fetchDemoSeed(page, base);
  const matterId = matterWithKrStatus(seed, "INSKICKAD");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  // KR-kortet visar väntetillståndet — det som saknades i demon före #882.
  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });

  // Fakturor på ärendet INNAN flödet. Utan den här mätningen kunde slut-
  // assertionen nedan gå igenom på en faktura som redan låg där.
  const invoiceLinks = page.locator('main a[href*="/invoices/"]');
  const invoicesBefore = await invoiceLinks.count();

  // Ett steg räcker inte: fakturaknappen finns INTE förrän beslutet är
  // registrerat. (Panelens egen "+ Skapa faktura" har plustecknet i namnet och
  // matchas inte av det förankrade uttrycket.)
  await expect(page.getByRole("button", { name: /^Skapa faktura$/ })).toHaveCount(0);

  // Steg 1: domstolens beslut. Ovillkorligt — knappen SKA finnas i det här läget.
  await page.getByRole("button", { name: /^Registrera beslut$/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Registrera domstolens beslut/i)).toBeVisible();
  await dialog.getByLabel(/Dömt belopp/i).fill(String(AWARDED_KR));
  await dialog.getByLabel(/Prutning/i).fill(String(PRUTNING_KR));
  await dialog.getByRole("button", { name: /^Spara beslut$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Steg 2: fakturan skapas ur beslutet (dialogen tar inget belopp — servern
  // läser det ur KR:n). Att knappen dyker upp FÖRST nu är hela poängen med att
  // flödet är tvådelat.
  await page.getByRole("button", { name: /^Skapa faktura$/ }).click();
  const verdict = page.getByRole("dialog");
  await expect(verdict.getByText(/Skapa faktura från beslut/i)).toBeVisible({ timeout: 15_000 });
  await expect(verdict.getByText(/Dömt belopp/i)).toBeVisible();
  await verdict.getByRole("button", { name: /^Skapa faktura$/ }).click();
  await expect(verdict).toBeHidden({ timeout: 20_000 });

  // Resultatet: en NY faktura på ärendet, och kostnadsräkningen är inte längre
  // i väntan.
  await expect(async () => {
    expect(await invoiceLinks.count()).toBeGreaterThan(invoicesBefore);
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0);
});

/**
 * Överklagandespåret (#828 steg 6). Ärendet vilar i ÖVERKLAGAD, så knappen
 * "Registrera hovrättens beslut" — den enda vägen till ett SLUTGILTIGT beslut —
 * går att köra. Före det här fanns spåret bara i koden: ingen KR i demon lämnade
 * någonsin BESLUTAD, så varken överklagandet eller hovrättsbeslutet syntes.
 */
test("överklagad kostnadsräkning: hovrättens beslut är slutgiltigt", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);

  const seed = await fetchDemoSeed(page, base);
  const matterId = matterWithKrStatus(seed, "OVERKLAGAD");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  // Ett överklagande är inte avgjort: varken fakturering eller ett nytt
  // överklagande ska erbjudas medan hovrätten har målet.
  await expect(page.getByRole("button", { name: /^Registrera hovrättens beslut$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Skapa faktura$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Överklaga prutning$/ })).toHaveCount(0);

  await page.getByRole("button", { name: /^Registrera hovrättens beslut$/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Dömt belopp/i).fill(String(AWARDED_KR));
  await dialog.getByRole("button", { name: /^Spara beslut$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Hovrättens beslut är slutgiltigt: fakturering öppnas, och det finns inget
  // mer att överklaga.
  await expect(page.getByRole("button", { name: /^Skapa faktura$/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Överklaga prutning$/ })).toHaveCount(0);
});
