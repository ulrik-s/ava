/**
 * E2E (demo): Rapporter visar advokatrapporten för förvald advokat och period (#1303).
 *
 * I demon lagras datum som ISO-strängar (lagret laddas från JSON). Rapporten
 * kraschade då (`getUTCFullYear is not a function`), och panelerna visade
 * "Välj jurist och period." fast både advokat och period var valda.
 */
import { readFile } from "node:fs/promises";
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("förvald advokat och period → Sammanfattning och Veckor visar rapporten", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/reports/`);
  await expect(page.getByRole("heading", { name: "Rapporter", level: 1 })).toBeVisible({ timeout: 30_000 });

  const lawyer = page.getByLabel("Advokat", { exact: true });
  await expect(lawyer).not.toHaveValue("");
  const lawyerName = (await lawyer.locator("option:checked").textContent()) ?? "";

  // Sammanfattningen: advokatens namn och totaltiden.
  await expect(page.getByText("Totalt tid", { exact: true })).toBeVisible();
  await expect(page.getByText(lawyerName, { exact: true }).last()).toBeVisible();

  // Veckotabellen (flik bredvid Ärenden).
  await showPanel(page, "Veckor");
  await expect(page.getByText(/Timdebitering per vecka/)).toBeVisible();

  await expect(page.getByText("Välj jurist och period.")).toHaveCount(0);
  await expect(page.getByText(/Rapporten kunde inte hämtas/)).toHaveCount(0);
});

/** "−6 971,25 kr" → -697125 (öre). */
function ore(text: string): number {
  const clean = text.replace(/\s|kr/g, "").replace("−", "-").replace(",", ".");
  return Math.round(Number.parseFloat(clean) * 100);
}

test("Kundfordringar: bryggans förfallna belopp stämmer med åldersanalysen (#1312)", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/reports/`);
  await showPanel(page, "Kundfordringar");
  const panel = page.getByRole("heading", { name: "Kundfordringar" }).locator("xpath=ancestor::div[contains(@class,'dv-content-container')][1]");
  const bridgeRow = panel.getByText("varav förfallet", { exact: true }).locator("xpath=..");
  await expect(bridgeRow).toBeVisible({ timeout: 30_000 });
  const forfallet = ore((await bridgeRow.innerText()).replace("varav förfallet", ""));

  const aging = panel.getByRole("heading", { name: /Åldersanalys/ }).locator("xpath=..");
  const agingText = await aging.innerText();
  const buckets = [...agingText.matchAll(/(?:dagar)\s+(−?[\d\s]+,\d{2}\s?kr)/g)].map((m) => ore(m[1] ?? "0"));
  const agingTotal = buckets.reduce((s, b) => s + b, 0);
  expect(forfallet).toBe(agingTotal);
});

test("Exportera Excel laddar ner rapporten som CSV med de tre avsnitten (#1793)", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/reports/`);
  const button = page.getByRole("button", { name: "Exportera Excel" });
  await expect(button).toBeEnabled({ timeout: 30_000 });

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^tidsrapport_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const lines = (await readFile(path, "utf8")).replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe("Ärenden under perioden");
  expect(lines).toContain("Timdebitering per vecka");
  expect(lines).toContain("Upparbetat, icke fakturerat");
});

/** Kalenderdagen `n` dagar före i dag ("YYYY-MM-DD", svensk tid). */
function daysBeforeToday(n: number): string {
  const day = new Date(Date.now() - n * 86_400_000);
  return day.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

test("Stapeldiagram: veckans staplar, och en stapel med tid visar ärenden som länkar (#2110)", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/reports/`);
  await expect(page.getByLabel("Advokat", { exact: true })).not.toHaveValue("", { timeout: 30_000 });
  await showPanel(page, "Stapeldiagram");

  // Vecka är förvald: sju dagsstaplar för veckan som innehåller Till (i dag).
  const dayBars = page.getByRole("button", { name: /^\p{L}+ \d{1,2} \p{L}+: [\d,]+ h$/u });
  await expect(dayBars).toHaveCount(7, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /^Vecka \d+ \d{4}/ })).toBeVisible();

  // Seeden lägger tid varannan dag bakåt från byggdagen, fördelat mellan
  // användarna: en månad bakåt från Till har säkert tid för vald advokat.
  await page.getByLabel("Till", { exact: true }).fill(daysBeforeToday(3));
  await page.getByRole("button", { name: "Månad", exact: true }).click();
  const withTime = page.getByRole("button", { name: /^Vecka \d+: (?!0 h$)[\d,]+ h$/ }).first();
  await expect(withTime).toBeVisible({ timeout: 30_000 });
  await withTime.click();
  await expect(withTime).toHaveAttribute("aria-pressed", "true");

  const matterLink = page.getByRole("link", { name: /^\d{4}-\d{4} — / }).first();
  await expect(matterLink).toBeVisible();

  const scroll = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll.width).toBeLessThanOrEqual(scroll.client);

  await matterLink.click();
  await expect(page).toHaveURL(/\/matters\//);
});
