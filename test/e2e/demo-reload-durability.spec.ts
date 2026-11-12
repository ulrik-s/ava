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
import type { Locator, Page } from "@playwright/test";
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
// ärendehuvudet under "Målnummer" (trimmat, som text #1566). Ligger här
// eftersom demo-E2E:s testMatch listar specfilerna explicit.
test("nytt ärende med målnummer → målnumret syns i ärendehuvudet", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Målnummer e2e ${Date.now()}`;
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill(title);
  await page.getByLabel("Målnummer").fill("  T 9876-26 ");
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);

  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  await expect(page.getByTestId("matter-court-case-number")).toHaveText("Målnummer: T 9876-26", { timeout: 25_000 });
});

/** Öppnar ärendehuvudets "Ändra"-dialog (#1565), där uppgifterna ändras (#1566). */
async function openEditDialog(page: Page): Promise<Locator> {
  await page.getByTestId("matter-header").getByRole("button", { name: "Ändra ärende" }).click({ timeout: 25_000 });
  return page.getByRole("dialog", { name: "Ändra ärende" });
}

/** Sparar dialogen med dess enda "Spara" och väntar tills den stängts. */
async function saveDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dialog).toBeHidden();
}

// #1510: byts målnumret sparas det gamla som "Tidigare målnr" (visas i
// ärendehuvudet) och ärendet går att söka fram på det gamla numret. Bytet görs
// i "Ändra"-dialogen och huvudet visar texten även efter omladdning (#1566).
test("byt målnummer → tidigare målnummer visas och är sökbart", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const stamp = Date.now();
  const title = `Tidigare målnr e2e ${stamp}`;
  const oldNumber = `T ${stamp}-26`;
  const newNumber = `B ${stamp}-26`;
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill(title);
  await page.getByLabel("Målnummer").fill(oldNumber);
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);

  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  const header = page.getByTestId("matter-header");
  await expect(header.getByTestId("matter-court-case-number")).toHaveText(`Målnummer: ${oldNumber}`, { timeout: 25_000 });
  const dialog = await openEditDialog(page);
  await dialog.getByLabel("Målnummer").fill(newNumber);
  await saveDialog(dialog);

  await page.reload();
  await expect(header.getByTestId("matter-court-case-number")).toHaveText(`Målnummer: ${newNumber}`, { timeout: 25_000 });
  await expect(header.getByText(`Tidigare målnr ${oldNumber}`, { exact: true })).toBeVisible();
  await expect(header.getByRole("textbox")).toHaveCount(0);

  await page.goto(`${BASE}/matters/`);
  await page.getByPlaceholder("Sök ärenden...").fill(oldNumber);
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible({ timeout: 25_000 });
});

// #1511 + #1532: försäkringsreferensen visas bara när ett försäkringsbolag är
// kontakt i en annan roll än motpart/motpartsombud, då med streck tills den
// fyllts i (#1566); den ändras i "Ändra"-dialogen, står kvar och är sökbar.
test("försäkringsreferens: dold när bolaget är motpart, visas med försäkringsbolag → sökbar", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = "Trafikskada Ek mot Folksam"; // seed: försäkringsbolaget är motpart
  const reference = `SK-${Date.now()}`;
  await page.goto(`${BASE}/matters/`);
  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  const header = page.getByTestId("matter-header");
  await expect(header.getByTestId("matter-court-case-number")).toBeVisible({ timeout: 25_000 });
  await expect(header.getByTestId("matter-insurance-reference")).toHaveCount(0);

  await showPanel(page, "Kontakter");
  await page.getByRole("button", { name: "+ Lägg till" }).click();
  await page.getByLabel("Roll i ärendet").selectOption("FORSAKRINGSBOLAG");
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill("Trygg-Hansa");
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: /Trygg-Hansa/ }).first().click();

  const shown = header.getByTestId("matter-insurance-reference");
  await expect(shown).toHaveText("Försäkringsreferens: –", { timeout: 25_000 });
  const dialog = await openEditDialog(page);
  await dialog.getByLabel("Försäkringsreferens").fill(reference);
  await saveDialog(dialog);

  await page.reload();
  await expect(shown).toHaveText(`Försäkringsreferens: ${reference}`, { timeout: 25_000 });

  await page.goto(`${BASE}/matters/`);
  await page.getByPlaceholder("Sök ärenden...").fill(reference);
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible({ timeout: 25_000 });
});

// #1565: en enda "Ändra" i ärendehuvudet öppnar en dialog där ärendetyp (ur
// byråns lista), målnummer och betalningssätt ändras och sparas med EN "Spara".
// Huvudet visar dem som text (#1566), ärendetypen i fetstil.
test("Ändra ärende: ärendetyp, målnummer och betalningssätt sparas och står kvar efter omladdning", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const stamp = Date.now();
  const listed = `Dialog ${stamp}`;
  const caseNumber = `T ${stamp}-26`;
  await page.goto(`${BASE}/settings/`);
  await showPanel(page, "Ärendetyper");
  const draft = page.getByPlaceholder("Ny ärendetyp, t.ex. Bodelning");
  await draft.fill(listed);
  await draft.press("Enter");
  await expect(page.getByLabel(`Ta bort ${listed}`)).toBeVisible({ timeout: 25_000 });

  await page.goto(`${BASE}/matters/`);
  const title = "Vårdnadstvist Andersson";
  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  const header = page.getByTestId("matter-header");
  const dialog = await openEditDialog(page);
  await dialog.getByLabel("Ärendetyp").selectOption(listed);
  await dialog.getByLabel("Målnummer").fill(caseNumber);
  await dialog.getByLabel("Betalningssätt", { exact: true }).selectOption("PRIVAT");
  await expect(dialog.getByRole("button", { name: "Spara", exact: true })).toHaveCount(1);
  await saveDialog(dialog);

  await page.reload();
  await expect(header.getByTestId("matter-type")).toHaveText(listed, { timeout: 25_000 });
  await expect(header.getByTestId("matter-type")).toHaveCSS("font-weight", "700");
  await expect(header.getByTestId("matter-court-case-number")).toHaveText(`Målnummer: ${caseNumber}`);
  await expect(page.getByTestId("matter-payment-line")).toContainText("Privat betalning");
});
