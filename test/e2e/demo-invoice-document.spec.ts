/**
 * E2E (demo): exakt det rapporterade flödet, helt automatiserat.
 *
 *   Logga in som "Anna Advokat" → Ärenden → "Brottmål — ekobrott Carlsson"
 *   → "Ange dom + prutning" → "Skapa faktura" → klicka "Faktura"-länken i
 *   kostnadsräkningsraden → på fakturasidan, klicka dokumentnamnet
 *   "Faktura ….pdf" i Fakturadokument-panelen.
 *
 * Förväntat: PDF:en öppnas i en SEPARAT FLIK. Buggen var att man istället
 * dirigerades in i ärendet (dokumentnamnet länkade till /matters) — ofta med
 * React #418 på köpet. Testet failar om man navigeras till /matters eller om
 * #418 dyker upp.
 *
 * Kör mot live-demon (default) eller en lokalt serverad out/:
 *   yarn e2e:demo
 *   AVA_DEMO_BASE_URL=http://localhost:8080/ava yarn e2e:demo
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";

// Seed-identiteter (ur .ava/meta.json). "Logga in som Anna" = seedad config.
const ANNA = "e1c7d494-c148-5998-b717-df386937d5a1";
const ORG = "83f68f9a-5f27-5199-b54b-e4b2fa380e14";
const MATTER = "92d63776-c955-54dc-8430-3573bed7829b"; // Brottmål — ekobrott Carlsson

test("fakturadokument öppnas i ny flik — dirigeras INTE in i ärendet (+ ingen #418)", async ({ page, context, baseURL }) => {
  const base = baseURL ?? "https://ulrik-s.github.io/ava";

  // "Logga in som Anna Advokat" — seeda demo-config (samma som /login skriver).
  await context.addInitScript(([anna, org]) => {
    try {
      localStorage.setItem("ava.firma", JSON.stringify({
        tier: "demo", repo: "ulrik-s/ava", token: "",
        principalId: anna, organizationId: org,
        authorName: "Anna Advokat", authorEmail: "user@ava.demo",
      }));
    } catch { /* ignore */ }
  }, [ANNA, ORG]);

  const hydrationErrors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (/#418|Minified React error 418|Hydration failed/i.test(m.text())) hydrationErrors.push(m.text());
  });
  page.on("pageerror", (e) => { if (/#418|418/.test(e.message)) hydrationErrors.push(e.message); });

  // Ärendet (Brottmål — ekobrott Carlsson).
  await page.goto(`${base}/matters/${MATTER}/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: /ekobrott Carlsson/i })).toBeVisible({ timeout: 30_000 });

  // "Ange dom + prutning" → "Skapa faktura" (om kostnadsräkningen väntar på dom).
  const verdictBtn = page.getByRole("button", { name: /Ange dom \+ prutning/i });
  if (await verdictBtn.count()) {
    await verdictBtn.first().click();
    await page.getByRole("button", { name: /^Skapa faktura$/ }).click();
    // Fakturan + fakturadokumentet genereras + persisteras.
    await page.waitForTimeout(6000);
  }

  // "Faktura"-länken längst till höger i kostnadsräkningsraden → fakturasidan.
  const fakturaLink = page.locator('main a[href*="/invoices/"]').first();
  await expect(fakturaLink).toBeVisible({ timeout: 15_000 });
  await fakturaLink.click();
  await expect(page).toHaveURL(/\/invoices\//, { timeout: 20_000 });
  await page.waitForTimeout(4000); // bootstrap + rehydrering av genererat dokument

  // Fakturadokument-panelen: dokumentnamnet "Faktura ….pdf". Lokalisera via TEXT
  // så det fångar både den BUGGIGA varianten (en <a>-länk till /matters) och den
  // FIXADE (en <button> som öppnar dokumentet).
  const docEl = page.getByText(/Faktura .*\.pdf/i).first();
  await expect(docEl).toBeVisible({ timeout: 15_000 });

  const urlBeforeClick = page.url();

  // Klick ska öppna PDF:en i NY FLIK (popup) — inte navigera huvudsidan in i
  // ärendet. (Buggen: namnet var en länk till /matters → hård-nav dit.)
  const popupPromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
  await docEl.click();
  const popup = await popupPromise;

  // KÄRN-ASSERTIONS:
  // 1) Huvudsidan ska INTE ha navigerat in i ärendet.
  expect(page.url(), "huvudsidan ska stanna på fakturasidan, inte gå till /matters").not.toMatch(/\/matters\//);
  expect(page.url()).toBe(urlBeforeClick);
  // 2) En ny flik (PDF) ska ha öppnats.
  expect(popup, "dokumentet ska öppnas i en ny flik").not.toBeNull();
  // 3) Ingen hydrerings-#418.
  expect(hydrationErrors, `React #418 / hydrerings-fel: ${hydrationErrors.join(" | ")}`).toEqual([]);
});
