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
 *
 * Förordnandemålet (#1858): samma flöde med förordnandetaxan (DVFS 2025:5).
 * Dokumentet kan inte genereras förrän förundersökningens avslut är valt.
 *
 * Domstolen (#1891): "Byt domstol…" i samma dialog väljer en annan domstol bland
 * byråns domstolar; anteckningen nämner den, och ärendets parter är oförändrade.
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

test("förordnandemål: avslutet krävs, och 'Yrkat i kostnadsräkning' = dialogens total", async ({ page }) => {
  const matterId = matterWithKrStatus(await fetchDemoSeed(page, BASE), "INSKICKAD");
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/${matterId}/`);
  await showPanel(page, "Fakturering");

  // Den inskickade kostnadsräkningen ångras — ärendet räknas på förordnandetaxan.
  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => { void d.accept(); });
  await page.getByRole("button", { name: /^Ångra kostnadsräkning$/ }).click();
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole("button", { name: "+ Skapa faktura" }).click();
  await page.getByRole("button", { name: "Kostnadsräkning till domstol" }).click();
  const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Förhandsvisning" });
  await expect(modal).toBeVisible();

  await modal.getByLabel("Förordnandetaxa (DVFS 2025:5)").check();
  await expect(modal.getByText("STOPPA NU")).toHaveCount(0);
  // Förhören ur ärendets poster (antal och tid), eller taxans lägsta belopp utan förhör.
  await expect(modal.getByRole("region", { name: "Förhör" })).toContainText(/sammanlagt|Inga förhör/);
  const generate = modal.getByRole("button", { name: /Generera \+ (spara|öppna mail)/ });
  await expect(generate).toBeDisabled();

  await modal.getByLabel("Lades ned").check();
  await expect(generate).toBeEnabled();

  const total = modal.locator("dt", { hasText: "Total" }).locator("xpath=following-sibling::dd[1]");
  const claimed = kronor(await total.textContent());
  expect(claimed).toBeGreaterThan(0);

  await generate.click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  const card = page.getByText("Yrkat i kostnadsräkning", { exact: true }).locator("xpath=..");
  await expect.poll(async () => kronor(await card.textContent()), { timeout: 15_000 }).toBe(claimed);
});

test("kostnadsräkning på ett intervall (#1889): bara posterna i intervallet yrkas, resten står kvar ofakturerat", async ({ page }) => {
  const matterId = matterWithKrStatus(await fetchDemoSeed(page, BASE), "INSKICKAD");
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/${matterId}/`);
  await showPanel(page, "Fakturering");

  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => { void d.accept(); });
  await page.getByRole("button", { name: /^Ångra kostnadsräkning$/ }).click();
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0, { timeout: 20_000 });
  const unbilled = page.getByText("Upparbetat ofakturerat", { exact: true }).locator("xpath=..");
  await expect.poll(async () => kronor(await unbilled.textContent()), { timeout: 15_000 }).toBeGreaterThan(0);
  const unbilledBefore = kronor(await unbilled.textContent());

  await page.getByRole("button", { name: "+ Skapa faktura" }).click();
  await page.getByRole("button", { name: "Kostnadsräkning till domstol" }).click();
  const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Förhandsvisning" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/Poster att fakturera \(\d+\/\d+ valda\)/)).toBeVisible({ timeout: 15_000 });

  // Intervallet: postlistans tidigaste dag — de senare posterna lämnas kvar.
  const days = (await modal.locator("label span.font-mono.text-gray-500").allTextContents()).sort();
  const first = days[0] ?? "";
  await modal.getByLabel("Från och med").fill(first);
  await modal.getByLabel("Till och med").fill(first);
  const heading = await modal.getByText(/Poster att fakturera/).textContent();
  const [chosen, all] = (heading ?? "").match(/\d+/g)?.map(Number) ?? [];
  expect(chosen).toBeGreaterThan(0);
  expect(chosen).toBeLessThan(all ?? 0);

  // Med en vald förhandlingspost krävs klockans tid; annars yrkas bara posterna.
  if (await modal.getByText("STOPPA NU").count() > 0) {
    await modal.locator('input[type="datetime-local"]').nth(0).fill("2026-09-22T09:00");
    await modal.locator('input[type="datetime-local"]').nth(1).fill("2026-09-22T10:35");
  }
  await modal.getByRole("button", { name: /Generera \+ (spara|öppna mail)/ }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  await expect.poll(async () => kronor(await unbilled.textContent()), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(kronor(await unbilled.textContent())).toBeLessThan(unbilledBefore);
});

test("byt domstol i kostnadsräkningen: anteckningen nämner den valda domstolen", async ({ page }) => {
  const matterId = matterWithKrStatus(await fetchDemoSeed(page, BASE), "INSKICKAD");
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/${matterId}/`);
  await showPanel(page, "Fakturering");

  await expect(page.getByText(/Väntar på dom/i).first()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => { void d.accept(); });
  await page.getByRole("button", { name: /^Ångra kostnadsräkning$/ }).click();
  await expect(page.getByText(/Väntar på dom/i)).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole("button", { name: "+ Skapa faktura" }).click();
  await page.getByRole("button", { name: "Kostnadsräkning till domstol" }).click();
  const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Förhandsvisning" });
  await expect(modal).toBeVisible();

  await modal.getByRole("button", { name: "Byt domstol…" }).click();
  const picker = page.getByRole("dialog", { name: "Välj domstol" });
  await expect(picker).toBeVisible();
  await expect(picker.getByText(/\+ Ny/)).toHaveCount(0);
  // Ärendet (2026-0017 i seeden) har Svea hovrätt som domstol — välj en ANNAN
  // domstol, annars säger testet inget om att parterna lämnas orörda.
  await picker.getByLabel("Sök domstol").fill("Göteborg");
  await picker.getByRole("button", { name: /Göteborgs tingsrätt/ }).click();
  await expect(picker).toBeHidden();
  await expect(modal.getByTestId("kr-court-name")).toHaveText("Göteborgs tingsrätt");
  await expect(modal.getByLabel("Målnummer")).toHaveValue("");

  const generate = modal.getByRole("button", { name: /Generera \+ (spara|öppna mail)/ });
  if (await modal.getByText("STOPPA NU").count() > 0) {
    await modal.locator('input[type="datetime-local"]').nth(0).fill("2026-09-22T09:00");
    await modal.locator('input[type="datetime-local"]').nth(1).fill("2026-09-22T10:35");
  }
  await generate.click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  await showPanel(page, "Anteckningar");
  const notes = page.getByRole("region", { name: "Anteckningar" }).last();
  await expect(notes.getByText(/Kostnadsräkning .* till Göteborgs tingsrätt skapad/).first()).toBeVisible({ timeout: 15_000 });

  await showPanel(page, "Parter");
  // Vänta in parterna (ärendets egen domstol står kvar) innan frånvaron prövas —
  // annars går toHaveCount(0) igenom redan innan tabellen ritats.
  const parties = page.getByRole("region", { name: "Parter" }).last();
  await expect(parties.getByText("Svea hovrätt")).toBeVisible({ timeout: 15_000 });
  await expect(parties.getByText("Göteborgs tingsrätt")).toHaveCount(0);
});
