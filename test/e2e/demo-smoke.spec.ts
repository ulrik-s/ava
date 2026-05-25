/**
 * Smoke-tester mot demo-bygget på GitHub Pages. Verifierar att alla
 * sidor i sidopanelen returnerar 200 + renderar utan render-fel,
 * istället för att 404:a eller krascha.
 *
 * Kör mot live-demon (read-only check): `npx playwright test
 * test/e2e/demo-smoke.spec.ts`
 *
 * För lokal kör först `bash scripts/build-demo.sh && cd out &&
 * python3 -m http.server 8765`, sen sätt BASE_URL=http://localhost:8765/ava
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.AVA_DEMO_BASE_URL ?? "https://ulrik-s.github.io/ava";

const ROUTES = [
  { path: "/", expectText: /Dashboard|AVA/i },
  { path: "/demo/", expectText: /AVA Demo|Vill du prova/i },
  { path: "/matters/", expectText: /Ärenden|Nytt ärende/i },
  { path: "/contacts/", expectText: /Kontakter/i },
  { path: "/invoices/", expectText: /Fakturor/i },
  { path: "/time/", expectText: /Tidregistrering/i },
  { path: "/reports/", expectText: /Rapporter/i },
  { path: "/search/", expectText: /Sök|Dokumentsök/i },
  { path: "/conflicts/", expectText: /Jävskontroll/i },
  // /settings är fullständig i demo:n (datakälla + FSA + token-config)
  { path: "/settings/", expectText: /Inställningar/i },
  // Placeholders (Fas R17) — visar FeatureUnavailable istället för 404
  { path: "/templates/", expectText: /Dokumentmallar|Inte tillgängligt/i },
  { path: "/users/", expectText: /Användare|Inte tillgängligt/i },
];

for (const { path, expectText } of ROUTES) {
  test(`demo: ${path} renderar utan 404`, async ({ page }) => {
    const response = await page.goto(`${BASE}${path}`);
    expect(response?.status(), `HTTP-status för ${path}`).toBe(200);
    // Vänta lite så bundle:n hinner hydrera
    await expect(page.locator("body")).toContainText(expectText, { timeout: 15_000 });
    // Garantera att vi inte landat på Next.js 404-sidan. Vi kan inte
    // bara matcha textContent på body, eftersom Next.js sätter
    // 404-fallback-strängen i __next_f-payload:n för ALLA sidor (som
    // potentiell not-found-boundary). Vi kollar bara synliga element:
    // Next:s 404-sida har specifikt en <h1 class="next-error-h1">404</h1>
    // Om den är synlig så är vi på 404-sidan.
    const errorH1 = page.locator("h1.next-error-h1");
    await expect(errorH1).toHaveCount(0, { timeout: 1000 }).catch(async () => {
      // Om den finns: kolla att den inte är synlig (kan ligga i en
      // hidden notFound-boundary som inte aktiverats)
      const visible = await errorH1.isVisible().catch(() => false);
      expect(visible, `404-sida visas för ${path}`).toBe(false);
    });
  });
}

// ── Djupare tester: hydratering + navigation ──────────────────────────────

test("dokumentmallar visas (data laddas från .ava/templates/)", async ({ page }) => {
  await page.goto(`${BASE}/templates/`);
  // "Kostnadsräkning till rätten" är en seed-mall (specifik nog för strict mode)
  await expect(page.getByRole("cell", { name: "Kostnadsräkning till rätten", exact: true })).toBeVisible({ timeout: 15_000 });
});

test("ärendelistan visar seed-data (Brottmål m-016)", async ({ page }) => {
  await page.goto(`${BASE}/matters/`);
  await expect(page.getByText(/Brottm/, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

test("kontaktlistan visar seed-data (Andersson)", async ({ page }) => {
  await page.goto(`${BASE}/contacts/`);
  await expect(page.getByText("Andersson", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

test("klick på matter öppnar detalj-sidan utan loop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(`${BASE}/matters/m-016-brottmal-rh/`);
  await expect(page.locator("body")).toContainText(/Brottm|m-016/i, { timeout: 15_000 });

  // Vänta lite och försäkra oss om att vi inte loop:ar till en redirect-sida
  await page.waitForTimeout(1500);
  expect(page.url(), "URL ska innehålla matter-id:t").toMatch(/m-016-brottmal-rh/);
  expect(errors, "inga script-errors").toEqual([]);
});

test("avbetalningsplaner-sidan listar seed-planerna", async ({ page }) => {
  await page.goto(`${BASE}/payment-plans/`);
  // Listan visar ärendenr (2026-XXXX) + klient-namn. Verifiera att åtminstone
  // en avbetalningsplan-länk syns (pp-001..pp-007 i seed).
  await expect(page.locator('a[href*="/payment-plans/pp-"]').first()).toBeVisible({ timeout: 15_000 });
});

test("matter-detalj visar seed-tider (regressionsskydd för org-id-bugen)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && m.text().includes("hydratisera")) errors.push(m.text()); });

  await page.goto(`${BASE}/matters/m-001-vardnad/`);
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });

  // Tidregistrering-sektionens innehåll: seed har te-001 "Genomgång av handlingar"
  await expect(page.getByText(/Genomgång av handlingar/)).toBeVisible({ timeout: 15_000 });

  // Inga hydration-warnings i console
  expect(errors, "ProjectionHydrator får inte kasta ZodError för seed-data").toEqual([]);
});

test("matter-detalj visar tabell-rader för fakturor/utlägg/tider", async ({ page }) => {
  await page.goto(`${BASE}/matters/m-001-vardnad/`);
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });

  const body = await page.locator("body").textContent();
  // Utlägg-summary syns (seed: Domstolsavgift, Parkeringsavgift)
  expect(body, "Utlägg ska visas på matter-detalj").toMatch(/Domstolsavgift|Parkeringsavgift/);
  // Tid-rad: HH:MM-format ("0:30" från te-001)
  expect(body, "Tid-rader ska visas").toMatch(/\d+:\d{2}/);
  // Inga "NaN kr" eller "Invalid Date" från brutna fält
  expect(body, "Inga NaN-belopp").not.toMatch(/NaN kr|Invalid Date/);
});

test("matter-detalj visar seed-dokument", async ({ page }) => {
  await page.goto(`${BASE}/matters/m-001-vardnad/`);
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });

  // Dokument från seed (Stämningsansökan / Förlikningsförslag etc.)
  await expect(page.getByText(/\.pdf|\.docx/i).first()).toBeVisible({ timeout: 15_000 });
});

test("SPA-fallback redirectar till app-shellen vid 404", async ({ page }) => {
  await page.goto(`${BASE}/matters/m-doesnt-exist-here/`);
  // 404.html → location.replace → app-shell hydraterar
  // Slutligen ska vi se nav-länken till Ärenden (alltså sidebar:n är synlig)
  await expect(page.locator("nav").getByRole("link", { name: /Ärenden/ })).toBeVisible({ timeout: 15_000 });
});
