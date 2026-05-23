/**
 * Delade helpers för scenario-baserade Playwright-tester.
 *
 * Designprinciper:
 *   - Varje scenario kör mot en deterministiskt seedad databas
 *     (scripts/seed-scenario-data.ts). Tester får INTE läcka tillstånd
 *     mellan sig — varje scenario kör seed igen.
 *   - Helpers wrappar vanliga UI-interaktioner (öppna sidebar-länk,
 *     fylla i form, klicka på modal-bekräftelser) så scenario-koden
 *     fokuserar på flödet, inte på selectorer.
 *   - Selectorer använder primärt user-visible text (role/text) så
 *     testerna går sönder när UI-text ändras → tvingar fram att vi
 *     uppdaterar både UI och test samtidigt.
 */

import { execSync } from "node:child_process";
import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Kör seed-scriptet synkront mot lokala Postgres. Anropas i `test.beforeEach`
 * så varje scenario startar från känt tillstånd.
 *
 * Förutsätter att DATABASE_URL pekar mot docker-compose-postgresen.
 */
export function reseedDatabase(): void {
  execSync("yarn tsx scripts/seed-scenario-data.ts", {
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://ava:ava_dev_password@localhost:5432/ava?schema=public",
    },
  });
}

/** Klicka på en länk i sidebaren (matchar text-innehåll). */
export async function clickSidebarLink(page: Page, label: string | RegExp): Promise<void> {
  await page.getByRole("link", { name: label }).first().click();
}

/** Hitta en knapp via tillgänglig text. */
export function button(page: Page, name: string | RegExp): Locator {
  return page.getByRole("button", { name });
}

/** Hitta ett text-input via label-text (i en form). */
export function input(page: Page, label: string | RegExp): Locator {
  return page.getByLabel(label);
}

/**
 * Vänta tills sidan inte är i "loading"-state. Vi matchar både
 * generella "Laddar…"-textsträngar och Next.js suspense-fallbacks.
 */
export async function waitForPageReady(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(/Laddar\.\.\.|Loading\.\.\./, { timeout: 10_000 });
}
