/**
 * E2E (demo): kostnadsräkningen i ett taxeärende yrkar SAMMA belopp i
 * körningen som i dokumentet (#1024, #1182).
 *
 * Buggen: dialogen räknade brottmålstaxan, men körningen som skapades lagrade
 * posternas egna á-priser som "yrkat". Kortet "Yrkat i kostnadsräkning", och
 * därefter beslut och prutning, visade ett belopp domstolen aldrig såg.
 *
 * Flödet i UI:t, på det offentliga uppdrag vars kostnadsräkning väntar på dom:
 * "Ångra kostnadsräkning" (den skickades in löpande) → "+ Skapa faktura" →
 * "Kostnadsräkning till domstol" → taxa, huvudförhandling 1 tim 35 min →
 * "Generera + spara". Kortet ska visa dialogens total, krona för krona.
 */
import { DEMO_BASE_URL as BASE, fetchDemoSeed, matterWithKrStatus, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

/** "10 706,00 kr" / "10 706 kr" → 10706 (kronor). */
const kronor = (s: string | null): number => Number.parseFloat((s ?? "").replace(/[^\d,]/g, "").replace(",", "."));

test("taxeärende: 'Yrkat i kostnadsräkning' = dialogens total (brottmålstaxan), inte posternas värde", async ({ page }) => {
  const matterId = matterWithKrStatus(await fetchDemoSeed(page, BASE), "INSKICKAD");
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/${matterId}/`);
  await showPanel(page, "Fakturering");

  // Den löpande kostnadsräkningen ångras — ärendet ska räknas på taxan.
  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => { void d.accept(); });
  await page.getByRole("button", { name: /^Ångra kostnadsräkning$/ }).click();
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole("button", { name: "+ Skapa faktura" }).click();
  await page.getByRole("button", { name: "Kostnadsräkning till domstol" }).click();
  const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Förhandsvisning" });
  await expect(modal).toBeVisible();

  await modal.getByLabel(/Taxa \(brottmålstaxan/).check();
  await modal.locator('input[type="datetime-local"]').nth(0).fill("2026-09-22T09:00");
  await modal.locator('input[type="datetime-local"]').nth(1).fill("2026-09-22T10:35");
  await expect(modal.getByText("(95 min)")).toBeVisible();

  const total = modal.locator("dt", { hasText: "Total" }).locator("xpath=following-sibling::dd[1]");
  const claimed = kronor(await total.textContent());
  expect(claimed).toBeGreaterThan(0);

  await modal.getByRole("button", { name: /Generera \+ (spara|öppna mail)/ }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  const card = page.getByText("Yrkat i kostnadsräkning", { exact: true }).locator("xpath=..");
  await expect.poll(async () => kronor(await card.textContent()), { timeout: 15_000 }).toBe(claimed);
});
