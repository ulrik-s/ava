/**
 * E2E (demo): jävskontrollen när ett ärende skapas (#1246, #1354).
 *
 * Klienten är motpart i ett av byråns ärenden → det nya ärendet får träffar att
 * bedöma, som syns i Att bevaka tills en advokat bedömt dem med en motivering.
 * Bedömningen (vem, när, varför) står sedan i ärendet. Demon har ingen server,
 * så kontrollen avgörs direkt i fliken.
 */
import type { Locator, Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

/** Lägg upp ett ärende med en befintlig kontakt som klient. */
async function createMatterFor(page: Page, title: string, klient: string): Promise<void> {
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill(title);
  await page.getByRole("button", { name: /Välj klient/ }).click();
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill(klient);
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: new RegExp(klient) }).first().click();
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  // Blanketten stängs när mutationen svarat (knappen heter "Skapar..." under tiden, #1386).
  await expect(page.getByLabel("Titel *")).toHaveCount(0);
}

/** Öppna ärendet ur listan via menyn; returnerar dess Att bevaka. */
async function openMatter(page: Page, title: string): Promise<Locator> {
  await page.getByRole("link", { name: /Ärenden/ }).first().click();
  await page.getByText(title).first().click();
  const watch = page.getByRole("region", { name: "Att bevaka" }).last();
  await expect(watch).toBeVisible({ timeout: 25_000 });
  return watch;
}

test("nytt ärende med en klient som är motpart i ett annat ärende → träffar att bedöma, tills de bedömts med motivering", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Jävskontroll e2e ${Date.now()}`;
  await createMatterFor(page, title, "Anna Andersson");

  // Träffarna syns i Att bevaka (där byråns andra ärenden kan ha egna träffar)…
  await page.getByRole("link", { name: /Att bevaka/ }).first().click();
  await page.getByRole("button", { name: "Jävskontroll" }).click();
  await expect(page.getByText(/Jävskontroll: \d+ träffar att bedöma/).first()).toBeVisible({ timeout: 15_000 });

  // …och i ärendets egen Att bevaka.
  const watch = await openMatter(page, title);
  await expect(watch.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toBeVisible({ timeout: 15_000 });

  // Bedömningen kräver en motivering (#1354) och dokumenteras på ärendet.
  await watch.getByRole("button", { name: "Bedöm träffarna" }).click();
  const save = watch.getByRole("button", { name: "Spara bedömning" });
  await expect(save).toBeDisabled();
  await watch.getByLabel("Motivering").fill("Motparten i det andra ärendet gäller en annan sak; ingen intressekonflikt.");
  await save.click();
  await expect(watch.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toHaveCount(0);
  const review = watch.getByRole("note", { name: "Jävskontrollens bedömning" });
  await expect(review).toContainText(/Jävskontrollen bedömd av .+ \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  await expect(review).toContainText("ingen intressekonflikt");
});

test("återkommande klient ger inga träffar; en ny motpart som är klient i ett annat ärende ger det (#1354)", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Motpart e2e ${Date.now()}`;
  // Fredrik Falk är bara klient i byråns andra ärenden — ingen jävsfråga.
  await createMatterFor(page, title, "Fredrik Falk");
  const watch = await openMatter(page, title);
  await expect(watch.getByText(/Jävskontroll/)).toHaveCount(0);

  // Erika Ek är klient i två av byråns ärenden — som motpart här är hon en träff.
  await page.getByRole("tab", { name: /^Kontakter/ }).first().click();
  await page.getByRole("button", { name: "+ Lägg till" }).click();
  const dialog = page.getByRole("dialog", { name: "Välj kontakt" });
  await expect(dialog.getByLabel("Roll i ärendet")).toHaveValue("MOTPART");
  await dialog.getByRole("searchbox").fill("Erika Ek");
  await dialog.getByRole("button", { name: /Erika Ek/ }).first().click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("tab", { name: /^Att bevaka/ }).first().click();
  await expect(watch.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toBeVisible({ timeout: 15_000 });
});
