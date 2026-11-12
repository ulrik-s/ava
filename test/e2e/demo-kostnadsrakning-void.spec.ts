/**
 * E2E (demo): "Ångra kostnadsräkning" tar bort kostnadsräkningens dokument (#1230).
 *
 * Ärendet vars KR väntar på dom → Fakturering → "Ångra kostnadsräkning" →
 * bekräftelsen säger att dokumentet tas bort → KR:n lämnar "väntar på dom" och
 * dess dokument (länkat via `billingRunId`) finns inte längre bland ärendets
 * dokument. Ärendet och dokumentet slås upp ur seeden.
 *
 * Den ångrade (annullerade) körningen är dold i Fakturering-listan från början
 * och tas fram med "Visa annullerade (N)" (#1523).
 */

import { type Page } from "@playwright/test";
import { DEMO_BASE_URL, fetchDemoSeed, seedDemoLogin, test, expect, showPanel, type DemoSeed } from "./_demo-test";

/** Listvyn visar ärendets alla dokument platt — även de som filats i mappar. */
async function useListView(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem("ava.documents.viewMode", "list"); } catch { /* privat läge */ }
  });
}

/** Den inskickade kostnadsräkningen och dess länkade dokument. */
function krWithDocument(seed: DemoSeed): { matterId: string; fileName: string } {
  const run = seed.billingRuns.find((r) => r.type === "KOSTNADSRAKNING" && r.kostnadsrakningStatus === "INSKICKAD");
  const doc = run && seed.documents.find((d) => d.billingRunId === run.id);
  if (!run || !doc?.fileName) throw new Error("seeden saknar en inskickad kostnadsräkning med länkat dokument (#1230)");
  return { matterId: run.matterId, fileName: doc.fileName };
}

test("ångrad kostnadsräkning: dokumentet tas bort ur ärendet", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await useListView(page);
  const { matterId, fileName } = krWithDocument(await fetchDemoSeed(page, base));

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  await showPanel(page, "Dokument");
  const docRow = page.getByRole("button", { name: fileName });
  await expect(docRow.first()).toBeVisible({ timeout: 30_000 });

  await showPanel(page, "Fakturering");
  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });
  let confirmText = "";
  page.once("dialog", (d) => { confirmText = d.message(); void d.accept(); });
  await page.getByRole("button", { name: /^Ångra kostnadsräkning$/ }).click();
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0, { timeout: 20_000 });
  expect(confirmText).toMatch(/tas bort/);

  await showPanel(page, "Dokument");
  await expect(docRow).toHaveCount(0, { timeout: 20_000 });
});

test("Fakturering-listan döljer den ångrade kostnadsräkningen tills man väljer att visa den (#1523)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const { matterId } = krWithDocument(await fetchDemoSeed(page, base));

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  await showPanel(page, "Fakturering");
  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => { void d.accept(); });
  await page.getByRole("button", { name: /^Ångra kostnadsräkning$/ }).click();
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0, { timeout: 20_000 });

  const annulled = page.getByRole("cell", { name: "Annullerad", exact: true });
  await expect(annulled).toHaveCount(0);
  await page.getByRole("button", { name: /^Visa annullerade \(\d+\)$/ }).click();
  await expect(annulled.first()).toBeVisible();
  await page.getByRole("button", { name: "Dölj annullerade" }).click();
  await expect(annulled).toHaveCount(0);
});
