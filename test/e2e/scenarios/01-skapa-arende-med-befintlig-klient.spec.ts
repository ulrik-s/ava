/**
 * Scenario 01: "Lägga upp ett nytt ärende — med befintlig klient"
 *
 * Användarjourney:
 *   1. Anna navigerar till Ärenden-listan
 *   2. Klickar "+ Nytt ärende"
 *   3. Fyller i titel + ärendetyp + beskrivning
 *   4. Väljer befintlig klient (Lars Andersson) från drop-down
 *   5. Klickar "Skapa ärende"
 *   6. Verifierar att det nya ärendet syns i listan
 *   7. Öppnar ärendet
 *   8. Verifierar att klienten är kopplad
 */

import { test, expect } from "@playwright/test";
import { reseedDatabase } from "./_helpers";

test.describe("Scenario: Skapa ärende med befintlig klient", () => {
  test.beforeEach(() => {
    // Återställ DB till känt tillstånd för varje test
    reseedDatabase();
  });

  test("ny ärende-rad dyker upp i listan + klient är kopplad", async ({ page }) => {
    // Steg 1: Navigera till ärendelistan
    await page.goto("/matters");
    await expect(page.getByRole("heading", { name: /Ärenden/i }).first()).toBeVisible();

    // Verifiera att seed:n har 7 ärenden från start
    await expect(page.getByText("2026-001")).toBeVisible();
    await expect(page.getByText("2026-007")).toBeVisible();

    // Steg 2: Klicka "+ Nytt ärende"
    await page.getByRole("button", { name: /Nytt ärende/i }).click();
    await expect(page.getByRole("heading", { name: "Nytt ärende" })).toBeVisible();

    // Steg 3+4: Fyll i form
    await page.getByLabel(/^Titel/).fill("Skadestånd — testfall 01");
    await page.getByLabel(/Klient/).selectOption({ label: "Lars Andersson" });
    await page.getByLabel(/Ärendetyp/).fill("Skadestånd");
    await page.getByLabel(/Beskrivning/).fill("Trafikolycka 2025-12-15, motpart erkänner inte ansvar.");

    // Steg 5: Submit
    await page.getByRole("button", { name: /Skapa ärende/i }).click();

    // Steg 6: Verifiera att ärendet syns i listan
    await expect(page.getByText("Skadestånd — testfall 01")).toBeVisible({ timeout: 5000 });

    // Steg 7: Öppna ärendet (klicka raden)
    await page.getByText("Skadestånd — testfall 01").click();

    // Steg 8: Verifiera klient-koppling
    await expect(page.getByRole("heading", { name: /Skadestånd — testfall 01/ })).toBeVisible();
    await expect(page.locator("body")).toContainText("Lars Andersson");
  });

  test("validering: titel krävs (HTML5 required)", async ({ page }) => {
    await page.goto("/matters");
    await page.getByRole("button", { name: /Nytt ärende/i }).click();

    // Försök submit utan titel
    await page.getByRole("button", { name: /Skapa ärende/i }).click();

    // Bröt mot HTML5-required → form submit blockerad, ingen redirect
    await expect(page.getByRole("heading", { name: "Nytt ärende" })).toBeVisible();
  });

  test("klient-väljaren listar alla 10 seed:ade kontakter", async ({ page }) => {
    await page.goto("/matters");
    await page.getByRole("button", { name: /Nytt ärende/i }).click();

    const klientSelect = page.getByLabel(/Klient/);
    // En "Välj klient..."-placeholder + 10 seeded → 11 options
    const optionCount = await klientSelect.locator("option").count();
    expect(optionCount).toBe(11);
    // Kolla några specifika namn
    await expect(klientSelect.locator('option:text("Lars Andersson")')).toHaveCount(1);
    await expect(klientSelect.locator('option:text("Brf Vinkeln")')).toHaveCount(1);
  });
});
