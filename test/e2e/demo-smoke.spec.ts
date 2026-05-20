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
  // Placeholders (Fas R17) — visar FeatureUnavailable istället för 404
  { path: "/templates/", expectText: /Dokumentmallar|Inte tillgängligt/i },
  { path: "/users/", expectText: /Användare|Inte tillgängligt/i },
  { path: "/settings/", expectText: /Inställningar|Inte tillgängligt/i },
];

for (const { path, expectText } of ROUTES) {
  test(`demo: ${path} renderar utan 404`, async ({ page }) => {
    const response = await page.goto(`${BASE}${path}`);
    expect(response?.status(), `HTTP-status för ${path}`).toBe(200);
    // Vänta lite så bundle:n hinner hydrera
    await expect(page.locator("body")).toContainText(expectText, { timeout: 15_000 });
    // Garantera att vi inte landat på Next.js 404
    const text = await page.locator("body").textContent();
    expect(text).not.toMatch(/This page could not be found/i);
  });
}
