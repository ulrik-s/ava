/**
 * E2E (demo): betalningssättet i ärendehuvudet (#1518) — etikett, försäkringsbolag
 * (vid rättsskydd) och klientens andel, på raden under titeln.
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, BASE);
});

test("rättsskyddsärende visar försäkringsbolaget efter etiketten", async ({ page }) => {
  // Seedens 2026-0012: rättsskydd med Trygg-Hansa som kontakt, ingen andel satt.
  await page.goto(`${BASE}/matters/m-012-skadestand-tha/`);
  await expect(page.getByTestId("matter-payment-line")).toHaveText("· Rättsskydd · Trygg-Hansa", { timeout: 30_000 });
});

test("rättsskyddsärende utan försäkringsbolag visar bara klientens andel", async ({ page }) => {
  // Seedens 2026-0021: rättsskydd, självrisk 20 %, inget försäkringsbolag som kontakt.
  await page.goto(`${BASE}/matters/m-021-rattsskydd-positivt/`);
  await expect(page.getByTestId("matter-payment-line")).toHaveText("· Rättsskydd · klienten betalar 20 %", { timeout: 30_000 });
});

test("rättshjälpsärende visar klientens andel", async ({ page }) => {
  // Seedens 2026-0010: rättshjälp med 40 % klientandel.
  await page.goto(`${BASE}/matters/m-010-vardnad-2/`);
  await expect(page.getByTestId("matter-payment-line")).toHaveText("· Rättshjälp · klienten betalar 40 %", { timeout: 30_000 });
});
