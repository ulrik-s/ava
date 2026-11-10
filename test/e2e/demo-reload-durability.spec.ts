/**
 * E2E (demo, #1386): en ändring överlever en omladdning DIREKT efter att den
 * sparats — ingen klient-navigering, ingen väntan, som en användare som laddar
 * om eller stänger fliken så fort blanketten stängts. Ett ärende med klient
 * skriver flera rader (ärende, mappar, klientkoppling); alla ska finnas kvar.
 *
 * "Sparat" = blanketten har stängts, dvs. mutationen har svarat. Knappen byter
 * till "Skapar..." medan den pågår, så att vänta på att "Skapa ärende" försvinner
 * laddade förut om MITT i sparandet — det var det #1386 såg.
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test("nytt ärende med klient → omedelbar omladdning → ärendet och klienten finns kvar", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Omladdning e2e ${Date.now()}`;
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill(title);
  await page.getByRole("button", { name: /Välj klient/ }).click();
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill("Fredrik Falk");
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: /Fredrik Falk/ }).first().click();
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);

  await page.reload();
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 25_000 });
  await expect(row).toContainText("Fredrik Falk");
});

// #1509: målnumret kan fyllas i redan i "Nytt ärende" och syns sedan i
// ärendehuvudet under "Målnummer" (trimmat). Ligger här eftersom demo-E2E:s
// testMatch listar specfilerna explicit.
test("nytt ärende med målnummer → målnumret syns i ärendehuvudet", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Målnummer e2e ${Date.now()}`;
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill(title);
  await page.getByLabel("Målnummer").fill("  T 9876-26 ");
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);

  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  await expect(page.getByLabel("Målnummer")).toHaveValue("T 9876-26", { timeout: 25_000 });
});
