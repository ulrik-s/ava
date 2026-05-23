/**
 * Scenario 05: "Slutfaktura → avbetalningsplan → betalningar → ändra plan
 *                → fler betalningar → slutbetalt → avsluta ärendet"
 *
 * Långt scenario — täcker hela betalkedjan från tidregistrering till
 * avslutat ärende. Verifierar varje steg i UI:n.
 *
 * Steg:
 *   1. Öppna vårdnad-ärendet, registrera 120 min (= 2 h @ 2500 kr/h = 5000 kr)
 *   2. Klicka "+ Slutfaktura" → bocka i tidsraden → Skapa
 *   3. Markera fakturan som "skickad" (SENT)
 *   4. Skapa avbetalningsplan: 1000 kr/månad
 *   5. Registrera betalning 1: 1000 kr
 *   6. Avbryt plan → skapa ny: 2000 kr/månad
 *   7. Registrera betalning 2: 2000 kr
 *   8. Registrera slut-betalning: 2000 kr (= totalt 5000 kr → PAID)
 *   9. Verifiera invoice-status = Betald
 *  10. Gå tillbaka till ärendet, klicka "Avsluta ärende"
 *  11. Verifiera matter-status = Stängt
 */

import { test, expect, type Page } from "@playwright/test";
import { reseedDatabase } from "./_helpers";

async function registerPayment(page: Page, amountSek: string): Promise<void> {
  await page.getByRole("button", { name: /Registrera betalning/ }).click();
  const modal = page.locator('div.fixed.inset-0').filter({ has: page.getByRole("heading", { name: /Registrera betalning/i }) });
  await expect(modal).toBeVisible({ timeout: 5000 });
  await modal.locator('input[type="number"]').first().fill(amountSek);
  await modal.getByRole("button", { name: /^Spara$/ }).click();
  await expect(modal).toBeHidden({ timeout: 10_000 });
}

test.describe("Scenario: Fakturera → plan → betalningar → slutbetalt → avsluta", () => {
  test.beforeEach(() => reseedDatabase());

  test("hela flödet end-to-end", async ({ page }) => {
    // ── Steg 1: registrera tid (120 min @ 2500 = 5000 kr) ─────
    await page.goto("/matters");
    await page.getByText("Vårdnad och umgänge — Andersson").click();
    await page.getByRole("button", { name: /Registrera tid/i }).click();
    await page.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
    await page.locator('input[type="number"]').first().fill("120");
    await page.getByPlaceholder(/Beskrivning/i).fill("Genomgång + stämning");
    await page.getByRole("button", { name: /^Spara$/ }).click();
    await expect(page.getByText("Genomgång + stämning")).toBeVisible({ timeout: 5000 });

    // ── Steg 2: skapa slutfaktura ────────────────────────────
    await page.getByRole("button", { name: /\+ Slutfaktura/ }).click();
    await expect(page.getByRole("heading", { name: /Skapa slutfaktura/ })).toBeVisible();
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: /^Skapa slutfaktura$/ }).click();
    await expect(page.getByRole("heading", { name: /Skapa slutfaktura/ })).toBeHidden({ timeout: 5000 });
    await expect(page.getByText(/Utkast/i).first()).toBeVisible();

    // ── Steg 3: öppna fakturan + markera som SENT ─────────────
    const openLink = page.getByRole("link", { name: /^Öppna$/ }).first();
    const href = await openLink.getAttribute("href");
    expect(href).toMatch(/^\/invoices\/[a-z0-9]+$/i);
    await openLink.click();
    await page.waitForURL(new RegExp(href!.replace(/\//g, "\\/")), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Markera som skickad/ })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Markera som skickad/ }).click();
    await expect(page.getByRole("button", { name: /Skapa avbetalningsplan/ })).toBeVisible({ timeout: 15_000 });

    // ── Steg 4: skapa avbetalningsplan 1000 kr/månad ──────────
    await page.getByRole("button", { name: /Skapa avbetalningsplan/ }).click();
    const planModal1 = page.locator('div.fixed.inset-0').filter({ has: page.getByRole("heading", { name: /Skapa avbetalningsplan/i }) });
    await planModal1.locator('input[type="number"]').first().fill("1000");
    await planModal1.getByRole("button", { name: /^Skapa plan$/ }).click();
    await expect(planModal1).toBeHidden({ timeout: 10_000 });

    // ── Steg 5: registrera första betalning (1000 kr) ─────────
    await registerPayment(page, "1000");
    await expect(page.locator("body")).toContainText(/1[\s ]?000[,.]00/, { timeout: 5000 });

    // ── Steg 6: avbryt plan + skapa ny på 2000 kr ─────────────
    await page.getByRole("button", { name: /Avbryt planen/i }).click();
    await expect(page.getByRole("button", { name: /Skapa avbetalningsplan/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Skapa avbetalningsplan/ }).click();
    const planModal2 = page.locator('div.fixed.inset-0').filter({ has: page.getByRole("heading", { name: /Skapa avbetalningsplan/i }) });
    await planModal2.locator('input[type="number"]').first().fill("2000");
    await planModal2.getByRole("button", { name: /^Skapa plan$/ }).click();
    await expect(planModal2).toBeHidden({ timeout: 10_000 });

    // ── Steg 7+8: registrera 2x 2000 kr så total = 5000 ───────
    await registerPayment(page, "2000");
    await registerPayment(page, "2000");

    // ── Steg 9: invoice ska vara Betald (PAID) ────────────────
    await expect(page.getByText(/Betald/i).first()).toBeVisible({ timeout: 15_000 });

    // ── Steg 10+11: tillbaka till ärendet och avsluta ─────────
    await page.goto("/matters/m-vardnad-andersson");
    await expect(page.getByRole("heading", { name: /Vårdnad och umgänge — Andersson/ })).toBeVisible({ timeout: 10_000 });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Avsluta ärende/ }).click();
    await expect(page.getByText(/^Stängt$/)).toBeVisible({ timeout: 5000 });
  });
});
