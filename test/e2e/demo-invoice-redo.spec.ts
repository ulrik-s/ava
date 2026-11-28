/**
 * E2E (demo): "Fel på fakturan?" → Kreditera och gör om (#2260).
 *
 * En skickad slutfaktura utan inbetalningar i ett privatärende → fakturasidan
 * → "Fel på fakturan?" → "Kreditera faktura … och gör om". Fakturan krediteras,
 * ärendets fakturering öppnas med faktureringsdialogen, och fakturans tidsposter
 * står där igen så att den rätta fakturan kan skapas direkt.
 *
 * Fakturan slås upp ur seeden (ingen hårdkodad id): en FINAL-faktura som en
 * slutfakturakörning skapat, SKICKAD, utan betalningar och utan slutreglering.
 */

import { DEMO_BASE_URL, fetchDemoSeed, seedDemoLogin, test, expect, type DemoSeed } from "./_demo-test";

/** Seedens fält som uppslagningen behöver utöver `DemoSeed`. */
interface RedoSeed extends DemoSeed {
  invoices: Array<DemoSeed["invoices"][number] & { invoiceType?: string; settlementBreakdown?: unknown; purpose?: string | null }>;
  billingRuns: Array<DemoSeed["billingRuns"][number] & { invoiceId?: string | null }>;
  payments?: Array<{ invoiceId: string }>;
  writeOffs?: Array<{ invoiceId: string }>;
}

/** En skickad slutfaktura som kan krediteras och göras om, med en tidspost på. */
function redoableInvoice(seed: RedoSeed): { id: string; invoiceNumber: string; matterId: string; entry: string } {
  const privat = new Set(seed.matters.filter((m) => m.paymentMethod === "PRIVAT").map((m) => m.id));
  const settled = new Set([...(seed.payments ?? []), ...(seed.writeOffs ?? [])].map((p) => p.invoiceId));
  const finalRunInvoices = new Set(seed.billingRuns.filter((r) => r.type === "FINAL" && r.status === "SENT").map((r) => r.invoiceId));
  for (const inv of seed.invoices) {
    const ok = inv.status === "SENT" && inv.invoiceType === "FINAL" && privat.has(inv.matterId) && !settled.has(inv.id)
      && finalRunInvoices.has(inv.id) && inv.settlementBreakdown == null && inv.invoiceNumber;
    const entry = seed.timeEntries.find((t) => t.invoiceId === inv.id);
    if (ok && entry && inv.invoiceNumber) return { id: inv.id, invoiceNumber: inv.invoiceNumber, matterId: inv.matterId, entry: entry.description };
  }
  throw new Error("seeden saknar en skickad, obetald slutfaktura i ett privatärende med tidsposter (#2260)");
}

test("kreditera och gör om: kreditnotan skapas och faktureringen öppnas med posterna igen", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const inv = redoableInvoice(await fetchDemoSeed(page, base));

  await page.goto(`${base}/invoices/${inv.id}/`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Fel på fakturan?" }).click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/kan inte ändras eller makuleras/)).toBeVisible();
  await dialog.getByLabel(/Anledning/).fill("Fel timpris");
  await dialog.getByRole("button", { name: `Kreditera faktura ${inv.invoiceNumber} och gör om` }).click();

  // Ärendets fakturering med faktureringsdialogen, och fakturans post är tillbaka.
  await expect(page).toHaveURL(new RegExp(`/matters/.*${inv.matterId}`), { timeout: 30_000 });
  const billing = page.getByRole("dialog", { name: "Faktura" });
  await expect(billing).toBeVisible({ timeout: 30_000 });
  await expect(billing.getByText(inv.entry).first()).toBeVisible({ timeout: 30_000 });
});
