/**
 * Smoke-tester mot demo-bygget: alla sidor i sidopanelen ska svara 200 och
 * rendera utan render-fel, i stället för att 404:a eller krascha.
 *
 * Kör mot en lokalt serverad `out/` (default):
 *   bun run build:demo
 *   bun tooling/scripts/serve-demo-static.ts &
 *   npx playwright test test/e2e/demo-smoke.spec.ts
 *
 * …eller mot live-demon (read-only check), på uttrycklig begäran:
 *   AVA_DEMO_BASE_URL=https://ulrik-s.github.io/ava npx playwright test test/e2e/demo-smoke.spec.ts
 *
 * Defaultet pekade förr på live-demon (#932): en "lokal" körning testade i
 * själva verket det som redan låg publicerat, inte branchen man satt på.
 */

import {
  DEMO_BASE_URL as BASE, fetchDemoSeed, matterIdWith, rowsForMatter, seedDemoLogin, test, expect,
} from "./_demo-test";

test.beforeEach(async ({ page }) => {
  // Tvinga demo-tier (localhost defaultar self-hosted → 401) OCH logga in:
  // sidorna bakom auth dirigerar annars till /login, och specen hade bara
  // verifierat inloggningsskärmen om och om igen.
  await seedDemoLogin(page, BASE);
});

const ROUTES = [
  { path: "/", expectText: /Startsida|AVA/i },
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

test("ärendelistan visar seedens egna ärenden", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  await page.goto(`${BASE}/matters/`);
  // Titeln kommer ur seeden, inte ur en hårdkodad sträng: listan ska visa det
  // datat demon faktiskt bär, vad seeden än döpt ärendena till.
  const title = seed.matters[0]?.title ?? "";
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

test("kontaktlistan visar seedens egna kontakter", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  await page.goto(`${BASE}/contacts/`);
  await expect(page.getByText(seed.contacts[0]?.name ?? "", { exact: false }).first())
    .toBeVisible({ timeout: 15_000 });
});

test("matter-detalj öppnas på sitt eget id utan loop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  const seed = await fetchDemoSeed(page, BASE);
  const matter = seed.matters[0];
  if (!matter) throw new Error("seeden saknar ärenden");

  await page.goto(`${BASE}/matters/${matter.id}/`);
  await expect(page.locator("body")).toContainText(matter.title, { timeout: 15_000 });

  // Vänta lite och försäkra oss om att vi inte loop:ar till en redirect-sida.
  // Seed-ärenden ÄR pre-renderade (`demoStaticParams("matters/active")`), så
  // URL:en ska stå kvar — ingen __shell__-omskrivning här.
  await page.waitForTimeout(1500);
  expect(page.url(), "URL ska behålla ärendets id").toContain(matter.id);
  expect(errors, "inga script-errors").toEqual([]);
});

test("avbetalningsplaner-sidan renderar", async ({ page }) => {
  // Sidan hade förr en assertion om `pp-`-länkar. Demons simulering (#880)
  // producerar inga avbetalningsplaner alls längre — se #982 — så ett test som
  // kräver planrader skulle påstå något om data som inte finns. Kvar är att
  // sidan renderar sitt tomläge utan att krascha.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/payment-plans/`);
  await expect(page.locator("body")).toContainText(/Avbetalningsplaner/i, { timeout: 15_000 });
  expect(errors, "inga script-errors").toEqual([]);
});

test("kontakt-detalj kraschar inte (c.children kan vara undefined)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 250)));

  // Flera kontakter — buggen satt i olika "shape" på seed-raderna, så det är
  // bredden som är poängen, inte vilka fyra kontakter det råkar vara.
  const seed = await fetchDemoSeed(page, BASE);
  for (const contact of seed.contacts.slice(0, 4)) {
    await page.goto(`${BASE}/contacts/${contact.id}/`);
    await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });
    await page.waitForTimeout(1000);
  }

  expect(errors.filter((e) => e.includes("children")), "ingen children-undefined-krasch").toEqual([]);
  expect(errors.filter((e) => e.includes("TypeError")), "inga TypeErrors").toEqual([]);
});

test("faktura-detalj öppnas via __shell__-shimmen, utan loop", async ({ page }) => {
  // Fakturor pre-renderas INTE per id (`static-params.ts` returnerar bara
  // sentinellen): id:na skapas av demo-generatorn vid körning och kan inte
  // enumereras vid build. Vägen dit är shimmen — okänd URL → 404.html →
  // `/invoices/__shell__/#orig=…` → `useRouteId`. Testet fällde förr på
  // `status === 200`, vilket krävde motsatsen till den arkitekturen.
  const seed = await fetchDemoSeed(page, BASE);
  for (const invoice of seed.invoices.slice(0, 2)) {
    await page.goto(`${BASE}/invoices/${invoice.id}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });
    // Shimmen bär det riktiga id:t i hash:en; appen ska ha plockat upp det och
    // renderat fakturan i stället för att fastna på sentinellen.
    await expect(page.locator("body"), "fakturan ska ha laddats, inte 'kunde inte ladda'")
      .not.toContainText(/kunde inte ladda/i);
    expect(decodeURIComponent(page.url()), "id:t ska följa med genom shimmen")
      .toContain(invoice.id);
  }
});

test("matter-detalj visar seed-tider (regressionsskydd för org-id-bugen)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && m.text().includes("hydratisera")) errors.push(m.text()); });

  const seed = await fetchDemoSeed(page, BASE);
  const matterId = matterIdWith(seed, "timeEntries");
  await page.goto(`${BASE}/matters/${matterId}/`);
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });

  // Tidregistrerings-sektionen ska visa ärendets EGEN tidspost ur seeden.
  const entry = rowsForMatter(seed, "timeEntries", matterId)[0];
  await expect(page.getByText(entry?.description ?? "").first()).toBeVisible({ timeout: 15_000 });

  // Inga hydration-warnings i console
  expect(errors, "ProjectionHydrator får inte kasta ZodError för seed-data").toEqual([]);
});

test("matter-detalj visar tabell-rader för fakturor/utlägg/tider", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  const matterId = matterIdWith(seed, "timeEntries", "expenses");
  await page.goto(`${BASE}/matters/${matterId}/`);
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });

  // RETRY-matchers, inte ett `textContent()`-ögonblick: `waitForFunction` ovan
  // väntar på "Laddar data", men appens första platshållare är "Laddar…" — en
  // ögonblicksbild kan alltså tas medan sidan fortfarande bootar. `useInnerText`
  // håller dessutom Next:s `__next_f`-script utanför matchningen, så en
  // NaN-sträng i script-payloaden inte kan fälla (eller rädda) testet.
  const body = page.locator("body");
  const opts = { useInnerText: true, timeout: 15_000 } as const;
  // Utlägget kommer ur seeden — samma rad som ska stå i tabellen.
  const expense = rowsForMatter(seed, "expenses", matterId)[0];
  await expect(body, "Utlägg ska visas på matter-detalj").toContainText(expense?.description ?? "", opts);
  // Tid-rad: HH:MM-format
  await expect(body, "Tid-rader ska visas").toContainText(/\d+:\d{2}/, opts);
  // Inga "NaN kr" eller "Invalid Date" från brutna fält
  await expect(body, "Inga NaN-belopp").not.toContainText(/NaN kr|Invalid Date/, opts);
});

test("matter-detalj visar seed-dokument", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  const matterId = matterIdWith(seed, "documents");
  await page.goto(`${BASE}/matters/${matterId}/`);
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });

  const doc = rowsForMatter(seed, "documents", matterId)[0];
  await expect(page.getByText(doc?.title ?? "").first()).toBeVisible({ timeout: 15_000 });
});

test("SPA-fallback redirectar till app-shellen vid 404", async ({ page }) => {
  await page.goto(`${BASE}/matters/m-doesnt-exist-here/`);
  // 404.html → location.replace → app-shell hydraterar
  // Slutligen ska vi se nav-länken till Ärenden (alltså sidebar:n är synlig)
  await expect(page.locator("nav").getByRole("link", { name: /Ärenden/ })).toBeVisible({ timeout: 15_000 });
});
