/**
 * E2E (demo): jävskontrollen när ett ärende skapas (#1246, #1354).
 *
 * Klienten är motpart i ett av byråns ärenden → det nya ärendet får träffar att
 * bedöma, som syns i Att åtgärda (#1734) men inte i Frister (#1735) tills en advokat bedömt dem med en motivering.
 * I ärendet står kontrollen och bedömningen (vem, när, varför) under fliken
 * Parter (#1733). Demon har ingen server,
 * så kontrollen avgörs direkt i fliken.
 */
import type { Locator, Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, matterIdWith, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

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

/** Öppna ärendet ur listan via menyn och fliken Parter; returnerar Parter (#1733). */
async function openMatterParties(page: Page, title: string): Promise<Locator> {
  await page.getByRole("link", { name: /Ärenden/ }).first().click();
  await page.getByText(title).first().click();
  await showPanel(page, "Parter");
  const parties = page.getByRole("region", { name: "Parter" }).last();
  await expect(parties).toBeVisible({ timeout: 25_000 });
  return parties;
}

test("nytt ärende med en klient som är motpart i ett annat ärende → träffar att bedöma, tills de bedömts med motivering", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Jävskontroll e2e ${Date.now()}`;
  await createMatterFor(page, title, "Anna Andersson");

  // Frister visar inga jävsträffar (#1735)…
  await page.getByRole("link", { name: /Frister/ }).first().click();
  await expect(page.getByRole("heading", { name: "Frister" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Jävskontroll" })).toHaveCount(0);
  await expect(page.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toHaveCount(0);

  // …träffarna står på sidan Att åtgärda, nådd från sidomenyn (#1734)…
  await page.getByRole("link", { name: /Att åtgärda/ }).first().click();
  await expect(page.getByRole("heading", { name: "Att åtgärda" }).first()).toBeVisible();
  await expect(page.getByText(/Jävskontroll: \d+ träffar att bedöma/).first()).toBeVisible({ timeout: 15_000 });

  // …och i ärendets flik Parter (#1733).
  const parties = await openMatterParties(page, title);
  await expect(parties.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toBeVisible({ timeout: 15_000 });

  // Bedömningen kräver en motivering (#1354) och dokumenteras på ärendet.
  await parties.getByRole("button", { name: "Bedöm träffarna" }).click();
  const save = parties.getByRole("button", { name: "Spara bedömning" });
  await expect(save).toBeDisabled();
  await parties.getByLabel("Motivering").fill("Motparten i det andra ärendet gäller en annan sak; ingen intressekonflikt.");
  await save.click();
  await expect(parties.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toHaveCount(0);
  const review = parties.getByRole("note", { name: "Jävskontrollens bedömning" });
  await expect(review).toContainText(/Jävskontrollen bedömd av .+ \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  await expect(review).toContainText("ingen intressekonflikt");
});

test("återkommande klient ger inga träffar; en ny motpart som är klient i ett annat ärende ger det (#1354)", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  const title = `Motpart e2e ${Date.now()}`;
  // Fredrik Falk är bara klient i byråns andra ärenden — ingen jävsfråga.
  await createMatterFor(page, title, "Fredrik Falk");
  const parties = await openMatterParties(page, title);
  await expect(parties.getByText(/Jävskontroll/)).toHaveCount(0);

  // Erika Ek är klient i två av byråns ärenden — som motpart här är hon en träff.
  await page.getByRole("button", { name: "+ Lägg till" }).click();
  const dialog = page.getByRole("dialog", { name: "Välj part" });
  await expect(dialog.getByLabel("Roll i ärendet")).toHaveValue("MOTPART");
  await dialog.getByRole("searchbox").fill("Erika Ek");
  await dialog.getByRole("button", { name: /Erika Ek/ }).first().click();
  await expect(dialog).toHaveCount(0);

  await expect(parties.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toBeVisible({ timeout: 15_000 });
});

/**
 * Sammanslagen sökning i ärendelistan (#1642): Sök/Enter kör jävskontrollen,
 * och ärendet där en part matchar visas med kolumnen "Träff" — även stängt.
 */
test("ärendelistans sökning: motpart i ett stängt ärende → 'Motpart: …' och status Stängt (#1642)", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/`);
  const search = page.getByPlaceholder("Sök ärenden...");
  await search.fill("Byggfirma Stenhammar");
  await search.press("Enter");

  await expect(page.getByText(/\d+ träff\(ar\) — bedöm om jäv föreligger/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("columnheader", { name: /Träff/ })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Konsumenttvist Ek mot byggfirma" });
  await expect(row.getByText(/Motpart: Byggfirma Stenhammar AB/)).toBeVisible();
  await expect(row.getByText("Stängt")).toBeVisible();

  // Rensad sökruta → listan som före sökningen.
  await search.fill("");
  await expect(page.getByRole("columnheader", { name: /Träff/ })).toHaveCount(0);
});

test("Nytt ärende: titeln fyller i sökrutan i 'Välj klient…', och vald klient fyller i en tom titel (#1644)", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/?new=1`);
  const title = page.getByLabel("Titel *");
  await title.fill("Anna Andersson");
  await page.getByRole("button", { name: /Välj klient/ }).click();
  const search = page.getByPlaceholder("Namn, personnummer eller organisationsnummer");
  await expect(search).toHaveValue("Anna Andersson");
  await expect(page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: /Anna Andersson/ }).first()).toBeVisible();
  await page.getByRole("dialog", { name: "Välj klient" }).getByRole("button", { name: "Avbryt" }).click();

  await title.fill("");
  await page.getByRole("button", { name: /Välj klient/ }).click();
  await expect(search).toHaveValue("");
  await search.fill("Anna Andersson");
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: /Anna Andersson/ }).first().click();
  await expect(title).toHaveValue("Anna Andersson");
});

test("Ärendet: rollen Klient i 'Lägg till' fyller i ärendets titel i sökrutan (#1645)", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  const seed = await fetchDemoSeed(page, BASE);
  const matter = seed.matters.find((m) => m.id === matterIdWith(seed, "timeEntries"));
  if (!matter) throw new Error("demodatan saknar ett ärende med tidsposter");
  await page.goto(`${BASE}/matters/${matter.id}/`, { waitUntil: "load" });
  await showPanel(page, "Parter");
  await page.getByRole("button", { name: "+ Lägg till" }).click();
  const dialog = page.getByRole("dialog", { name: "Välj part" });
  const search = dialog.getByRole("searchbox");
  await expect(search).toHaveValue("");
  await dialog.getByLabel("Roll i ärendet").selectOption("KLIENT");
  await expect(search).toHaveValue(matter.title.trim());
});
