/**
 * Scenario 04: "Registrera tid på ett ärende → verifiera i Rapporter"
 *
 * Användarjourney:
 *   1. Anna går till ett ärende (Vårdnad — Andersson)
 *   2. Klickar "+ Registrera tid"
 *   3. Fyller i datum, minuter, beskrivning
 *   4. Sparar
 *   5. Verifierar att raden syns i ärendets tids-tabell
 *   6. Verifierar totalsumman ovanför tabellen
 *   7. Navigerar till Rapporter
 *   8. Verifierar att ärendet syns i rapportens "Ärenden under perioden"
 *   9. Verifierar att antalet minuter återspeglas
 */

import { test, expect } from "@playwright/test";
import { reseedDatabase } from "./_helpers";

test.describe("Scenario: Tid → Rapport", () => {
  test.beforeEach(() => reseedDatabase());

  test("registrera 90 min på vårdnad-ärendet och se det i rapporten", async ({ page }) => {
    // Steg 1+2: Öppna vårdnad-ärendet
    await page.goto("/matters");
    await page.getByText("Vårdnad och umgänge — Andersson").click();
    await expect(page.getByRole("heading", { name: /Vårdnad och umgänge/ })).toBeVisible();

    // Steg 3: Klicka "+ Registrera tid"
    await page.getByRole("button", { name: /Registrera tid/i }).click();

    // Steg 4: Fyll i form (default datum är idag)
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(today);
    await page.locator('input[type="number"]').first().fill("90");
    await page.getByPlaceholder(/Beskrivning/i).fill("Genomgång av familjeförhållanden + utkast till stämning");

    // Steg 5: Spara
    await page.getByRole("button", { name: /^Spara$/ }).click();

    // Steg 6: Verifiera att raden syns + totalsumman
    await expect(page.getByText(/Genomgång av familjeförhållanden/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator("body")).toContainText(/totalt\s*1:30/i);

    // Steg 7: Navigera till Rapporter
    await page.getByRole("link", { name: /Rapporter/i }).first().click();
    await expect(page.getByRole("heading", { name: /Rapporter/i })).toBeVisible();

    // Välj Dev User (= ctx.user för auto-login i dev) eftersom det är
    // den användare som registrerade tiden via UI:n.
    await page.getByLabel("Advokat").selectOption({ label: "Dev User" });

    // Steg 8: Vårdnad-ärendet syns under "Ärenden under perioden"
    await expect(page.getByText(/Ärenden under perioden/i)).toBeVisible();
    await expect(page.getByText("Vårdnad och umgänge — Andersson").first()).toBeVisible({ timeout: 5000 });

    // Steg 9: Minutsumman speglar 90 min
    await expect(page.locator("body")).toContainText(/1:30/);
  });

  test("rapport visar 0 om ingen tid registrerats för advokaten i perioden", async ({ page }) => {
    // Anna har ingen tid kvar i seed → om vi går direkt till rapporter ska
    // "Ärenden under perioden" vara tom
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /Rapporter/i })).toBeVisible();
    // "Inga ärenden" eller liknande tom-state ska visas
    await expect(page.getByText(/Inga ärenden|0 ärenden|tomt|—/i).first()).toBeVisible();
  });
});
