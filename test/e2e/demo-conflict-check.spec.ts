/**
 * E2E (demo): jävskontrollen när ett ärende skapas (#1246).
 *
 * Klienten är redan part i byråns ärenden → det nya ärendet får träffar att
 * bedöma, som syns i Att bevaka tills en jurist markerat dem som bedömda.
 * Demon har ingen server, så kontrollen avgörs direkt i fliken.
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test("nytt ärende med en klient som redan är part → träffar i Att bevaka, tills de bedömts", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/?new=1`);
  await page.getByLabel("Titel *").fill("Jävskontroll e2e");
  await page.getByRole("button", { name: /Välj klient/ }).click();
  await page.getByPlaceholder("Namn, personnummer eller organisationsnummer").fill("Anna Andersson");
  await page.getByRole("list", { name: "Träffar" }).getByRole("button", { name: /Anna Andersson/ }).first().click();
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByRole("button", { name: "Skapa ärende" })).toHaveCount(0);

  await page.goto(`${BASE}/watchlist/`);
  await page.getByRole("button", { name: "Jävskontroll" }).click();
  const hit = page.getByText(/Jävskontroll: \d+ träffar att bedöma/);
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  await page.getByRole("button", { name: "Träffarna är bedömda" }).click();
  await expect(page.getByRole("button", { name: "Träffarna är bedömda" })).toHaveCount(0);

  await page.goto(`${BASE}/watchlist/`);
  await page.getByRole("button", { name: "Jävskontroll" }).click();
  await expect(page.getByText(/Jävskontroll: \d+ träffar att bedöma/)).toHaveCount(0);
});
