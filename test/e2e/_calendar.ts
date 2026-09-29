/**
 * Hjälpare för kalender-E2E i demon: skapa en händelse via formuläret
 * "Nytt event", valfritt speglad till Outlook.
 */
import { expect, type Page } from "@playwright/test";

/** Skapa en kalenderhändelse via UI:t och vänta tills formuläret stängts. */
export async function createCalendarEvent(page: Page, ev: { title: string; start: string; mirrorToOutlook: boolean }): Promise<void> {
  await page.getByRole("button", { name: /Nytt event/ }).click();
  const form = page.locator("form").filter({ hasText: "Spegla till Outlook" });
  await form.getByLabel("Titel *").fill(ev.title);
  await form.getByLabel("Start *").fill(ev.start);
  if (ev.mirrorToOutlook) await form.getByLabel(/Spegla till Outlook/).check();
  await form.getByRole("button", { name: "Skapa" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
}

/** Outlook "anslutet" i demon: en manuell token i localStorage. */
export async function seedOutlookToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem("ava.outlookToken", "e2e-outlook-token"); } catch { /* privat läge */ }
  });
}
