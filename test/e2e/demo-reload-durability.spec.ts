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
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

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

// #1510: byts målnumret sparas det gamla som "Tidigare målnr" (visas i
// ärendehuvudet) och ärendet går att söka fram på det gamla numret.
test("byt målnummer → tidigare målnummer visas och är sökbart", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const stamp = Date.now();
  const title = `Tidigare målnr e2e ${stamp}`;
  const oldNumber = `T ${stamp}-26`;
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill(title);
  await page.getByLabel("Målnummer").fill(oldNumber);
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);

  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  const field = page.getByLabel("Målnummer");
  await expect(field).toHaveValue(oldNumber, { timeout: 25_000 });
  await field.fill(`B ${stamp}-26`);
  await page.getByRole("button", { name: "Spara målnummer" }).click();
  await expect(page.getByText("Tidigare målnr")).toBeVisible();
  await expect(page.getByText(oldNumber, { exact: true })).toBeVisible();

  await page.goto(`${BASE}/matters/`);
  await page.getByPlaceholder("Sök ärenden...").fill(oldNumber);
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible({ timeout: 25_000 });
});

// #1511 + #1532: fältet "Försäkringsreferens" visas bara när ett försäkringsbolag
// är kontakt i en annan roll än motpart/motpartsombud; referensen sparas och är sökbar.
test("försäkringsreferens: dold när bolaget är motpart, visas med försäkringsbolag → sökbar", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = "Trafikskada Ek mot Folksam"; // seed: försäkringsbolaget är motpart
  const reference = `SK-${Date.now()}`;
  await page.goto(`${BASE}/matters/`);
  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  await expect(page.getByLabel("Målnummer")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByLabel("Försäkringsreferens")).toHaveCount(0);

  await showPanel(page, "Kontakter");
  await page.getByRole("button", { name: "+ Lägg till" }).click();
  await page.getByLabel("Roll i ärendet").selectOption("FORSAKRINGSBOLAG");
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill("Trygg-Hansa");
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: /Trygg-Hansa/ }).first().click();

  const field = page.getByLabel("Försäkringsreferens");
  await expect(field).toBeVisible({ timeout: 25_000 });
  await field.fill(reference);
  await page.getByRole("button", { name: "Spara försäkringsreferens" }).click();
  await expect(page.getByRole("button", { name: "Spara försäkringsreferens" })).toHaveCount(0);

  await page.goto(`${BASE}/matters/`);
  await page.getByPlaceholder("Sök ärenden...").fill(reference);
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible({ timeout: 25_000 });
});

// #1521: ärendetypen i ärendehuvudet är fetstil och inline-redigerbar; byråns
// ärendetyper föreslås (datalist) men fritext tillåts.
test("ärendetyp byts i ärendehuvudet → ur byråns lista och fritt skriven", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const stamp = Date.now();
  const listed = `Lista ${stamp}`;
  const free = `Fritext ${stamp}`;
  await page.goto(`${BASE}/settings/`);
  await showPanel(page, "Ärendetyper");
  const draft = page.getByPlaceholder("Ny ärendetyp, t.ex. Bodelning");
  await draft.fill(listed);
  await draft.press("Enter");
  await expect(page.getByLabel(`Ta bort ${listed}`)).toBeVisible({ timeout: 25_000 });

  await page.goto(`${BASE}/matters/`);
  const title = "Vårdnadstvist Andersson";
  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  const field = page.getByLabel("Ärendetyp");
  await expect(field).toHaveValue("Familjerätt", { timeout: 25_000 });
  await expect(field).toHaveCSS("font-weight", "700");
  await expect(page.locator(`datalist option[value="${listed}"]`)).toHaveCount(1);

  for (const value of [listed, free]) {
    await field.fill(value);
    await page.getByRole("button", { name: "Spara ärendetyp" }).click();
    await expect(page.getByRole("button", { name: "Spara ärendetyp" })).toHaveCount(0);
    await expect(page.getByLabel("Ärendetyp")).toHaveValue(value);
  }
  await expect(page.locator(`datalist option[value="${free}"]`)).toHaveCount(0);
});
