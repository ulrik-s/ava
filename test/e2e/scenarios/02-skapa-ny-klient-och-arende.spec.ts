/**
 * Scenario 02: "Skapa NY klient och koppla till ärende"
 *
 * Användarjourney:
 *   1. Anna går till Kontakter
 *   2. Skapar ny person-kontakt (Niklas Östberg)
 *   3. Verifierar att kontakten syns i listan
 *   4. Går till Ärenden → Nytt ärende
 *   5. Väljer den nyskapade klienten från drop-down
 *   6. Skapar ärendet
 *   7. Verifierar att klient-koppling är korrekt
 */

import { test, expect } from "@playwright/test";
import { reseedDatabase } from "./_helpers";

test.describe("Scenario: Skapa ny klient + koppla till nytt ärende", () => {
  test.beforeEach(() => reseedDatabase());

  test("full flow: ny kontakt → ny ärende med kopplad klient", async ({ page }) => {
    // Steg 1+2: Navigera till Kontakter och skapa ny
    await page.goto("/contacts");
    await expect(page.getByRole("heading", { name: /Kontakter/i }).first()).toBeVisible();

    // Verifiera seeded antal (10)
    await expect(page.getByText("Lars Andersson").first()).toBeVisible();

    // Klicka "+ Ny kontakt" / "Lägg till" (anpassa efter faktisk knapp)
    await page.getByRole("button", { name: /Ny kontakt|\+ Ny|Lägg till/i }).first().click();

    // Fyll formuläret
    await page.getByLabel(/Namn/i).fill("Niklas Östberg");
    const emailField = page.getByLabel(/^E-?post$/i).first();
    if (await emailField.isVisible().catch(() => false)) {
      await emailField.fill("niklas.ostberg@example.se");
    }

    // Spara
    await page.getByRole("button", { name: /Skapa|Spara/i }).first().click();

    // Steg 3: Kontakten ska synas
    await expect(page.getByText("Niklas Östberg").first()).toBeVisible({ timeout: 5000 });

    // Steg 4+5: Skapa ärende kopplat till nya klienten
    await page.goto("/matters");
    await page.getByRole("button", { name: /Nytt ärende/i }).click();
    await page.getByLabel(/^Titel/).fill("Avtal — testfall 02");
    await page.getByLabel(/Klient/).selectOption({ label: "Niklas Östberg" });
    await page.getByLabel(/Ärendetyp/).fill("Avtalsrätt");
    await page.getByRole("button", { name: /Skapa ärende/i }).click();

    // Steg 6+7: Verifiera
    await expect(page.getByText("Avtal — testfall 02")).toBeVisible({ timeout: 5000 });
    await page.getByText("Avtal — testfall 02").click();
    await expect(page.locator("body")).toContainText("Niklas Östberg");
  });
});
