/**
 * Scenario 06: "Acconto-faktura → betalad → slutfaktura med acconto-avdrag"
 *
 * Användarjourney (typisk advokat-praxis):
 *   1. Vid ärendestart kräver advokaten ett förskott (acconto) av klienten
 *   2. Acconto faktureras, markeras skickad, betalas
 *   3. Tid registreras under ärendet
 *   4. Vid avslut: slutfaktura skapas — tid + utlägg — med acconto AVDRAGEN
 *   5. Verifiera att slutfakturans nettobelopp = (tid+utlägg) - acconto
 *
 * Belopp i testet:
 *   - acconto: 3 000 kr (betalas i förskott)
 *   - tid: 120 min @ 2500 = 5 000 kr
 *   - slutfakturans NETTO: 5000 - 3000 = 2 000 kr
 */

import { test, expect } from "@playwright/test";
import { reseedDatabase } from "./_helpers";

test.describe("Scenario: Acconto + slutfaktura med avdrag", () => {
  test.beforeEach(() => reseedDatabase());

  test("acconto-flöde end-to-end", async ({ page }) => {
    // ── Steg 1: öppna ärendet ──────────────────────────────
    await page.goto("/matters/m-vardnad-andersson");
    await expect(page.getByRole("heading", { name: /Vårdnad och umgänge/ })).toBeVisible();

    // ── Steg 2a: skapa acconto-faktura (3000 kr) ──────────
    await page.getByRole("button", { name: /\+ Acconto/ }).click();
    const accontoModal = page.locator('div.fixed.inset-0').filter({ has: page.getByRole("heading", { name: /Ny acconto-faktura/i }) });
    await accontoModal.locator('input[type="number"]').first().fill("3000");
    await accontoModal.getByRole("button", { name: /^Skapa$/ }).click();
    await expect(accontoModal).toBeHidden({ timeout: 10_000 });

    // En faktura-rad med typ Acconto + status Utkast ska synas
    await expect(page.getByText(/Acconto/i).first()).toBeVisible();
    await expect(page.getByText(/Utkast/i).first()).toBeVisible();

    // ── Steg 2b: öppna acconto, markera som skickad, registrera betalning ──
    const openAccontoLink = page.getByRole("link", { name: /^Öppna$/ }).first();
    const accontoHref = await openAccontoLink.getAttribute("href");
    await openAccontoLink.click();
    await page.waitForURL(new RegExp(accontoHref!.replace(/\//g, "\\/")), { timeout: 30_000 });
    await page.getByRole("button", { name: /Markera som skickad/ }).click();
    await expect(page.getByRole("button", { name: /Registrera betalning/ })).toBeVisible({ timeout: 15_000 });

    // Registrera betalning 3000 kr
    await page.getByRole("button", { name: /Registrera betalning/ }).click();
    const paymentModal = page.locator('div.fixed.inset-0').filter({ has: page.getByRole("heading", { name: /Registrera betalning/i }) });
    await paymentModal.locator('input[type="number"]').first().fill("3000");
    await paymentModal.getByRole("button", { name: /^Spara$/ }).click();
    await expect(paymentModal).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(/Betald/i).first()).toBeVisible({ timeout: 10_000 });

    // ── Steg 3: tillbaka till ärendet, registrera tid (120 min) ──
    await page.goto("/matters/m-vardnad-andersson");
    await page.getByRole("button", { name: /Registrera tid/i }).click();
    await page.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
    await page.locator('input[type="number"]').first().fill("120");
    await page.getByPlaceholder(/Beskrivning/i).fill("Arbete efter förskott");
    await page.getByRole("button", { name: /^Spara$/ }).click();
    await expect(page.getByText("Arbete efter förskott")).toBeVisible({ timeout: 5000 });

    // ── Steg 4: skapa slutfaktura MED acconto-avdrag ──────
    await page.getByRole("button", { name: /\+ Slutfaktura/ }).click();
    const finalModal = page.locator('div.fixed.inset-0').filter({ has: page.getByRole("heading", { name: /Skapa slutfaktura/i }) });
    // Bocka i tidsraden
    await finalModal.locator('input[type="checkbox"]').first().check();
    // Bocka i acconto-avdrag (sista checkbox i modal — accontot ligger
    // sist i listan när det finns minst en tidsrad)
    const checkboxes = finalModal.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await checkboxes.last().check();
    await finalModal.getByRole("button", { name: /^Skapa slutfaktura$/ }).click();
    await expect(finalModal).toBeHidden({ timeout: 10_000 });

    // ── Steg 5: verifiera slutfakturans nettobelopp ──────
    // Faktura-listan: hitta slutfakturan (typ "Slutfaktura")
    await expect(page.getByText(/Slutfaktura/i).first()).toBeVisible();

    // Öppna slutfakturan (sista raden i fakturalistan)
    const finalOpenLink = page.getByRole("link", { name: /^Öppna$/ }).last();
    await finalOpenLink.click();

    // Page innehåller "Acconto-avdrag" + 3 000,00 + "Att betala" / "Netto" 2 000
    await expect(page.locator("body")).toContainText(/acconto/i, { timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/3[\s ]?000[,.]00/);
    await expect(page.locator("body")).toContainText(/2[\s ]?000[,.]00/);
  });
});
