/**
 * E2E (#1206): timpris per kategori med arv byrå → jurist → ärende. Byråns
 * inställningar har fyra timprisfält; juristens formulär visar sitt eget
 * timarvode och — i de tomma fälten — vad som ärvs.
 */

import { DEMO_BASE_URL, seedDemoLogin, test, expect } from "./_demo-test";

test("byrån och juristen har ett timprisfält per kategori; tomma fält visar det ärvda priset", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);

  await page.goto(`${base}/settings/`, { waitUntil: "load" });
  for (const label of [/^Timarvode \(kr/, /^Timarvode helg\/kväll/, /^Tidsspillan \(kr/, /^Tidsspillan helg\/kväll/]) {
    await expect(page.getByLabel(label)).toBeVisible({ timeout: 25_000 });
  }

  await page.goto(`${base}/users/`, { waitUntil: "load" });
  // Demojuristerna debiterar timkostnadsnormen som eget timarvode.
  await expect(page.getByText(/^1\s626 kr\/h$/).first()).toBeVisible({ timeout: 25_000 });
  await page.getByRole("link", { name: "Björn Bauer" }).click();

  await expect(page.getByLabel(/^Timarvode \(kr/)).toHaveValue("1626", { timeout: 25_000 });
  // Ingen kategori utöver timarvodet är satt → de ärver juristens timarvode.
  await expect(page.getByLabel(/^Tidsspillan helg\/kväll/)).toHaveAttribute("placeholder", /^ärvs: 1\s626 kr\/h$/);
});
