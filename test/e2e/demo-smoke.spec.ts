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
