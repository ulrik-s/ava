/**
 * E2E (#1221, #1735): en skapad men oskickad faktura står i ärendets flik
 * Fakturering, inte i Frister. Frister har bara tidsfrister och "Bör
 * faktureras" — inga faktureringssteg och inget filter för dem.
 */

import { DEMO_BASE_URL, fetchDemoSeed, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("oskickad faktura: i ärendets Fakturering, inte i Frister", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const unsent = seed.invoices.find((i) => i.status === "DRAFT" && i.invoiceNumber);
  if (!unsent?.invoiceNumber) throw new Error("seeden saknar en skapad men oskickad faktura (DRAFT) med nummer");

  await page.goto(`${base}/watchlist/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Frister" })).toBeVisible({ timeout: 25_000 });
  // Hela byrån — demoanvändaren är inte ansvarig för alla ärenden.
  await page.getByLabel("Bara mina ärenden").uncheck();
  await expect(page.getByRole("button", { name: "Ofakturerat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fakturering" })).toHaveCount(0);
  await expect(page.getByText(/Skicka faktura/)).toHaveCount(0);

  await page.goto(`${base}/matters/${unsent.matterId}/`, { waitUntil: "load" });
  await showPanel(page, "Fakturering");
  await expect(page.getByText(unsent.invoiceNumber, { exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole("region", { name: "Frister" }).getByText(/Skicka faktura/)).toHaveCount(0);
});
