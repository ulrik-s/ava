/**
 * E2E (demo): ingen hydreringsskillnad — och första klicket gäller (#1131).
 *
 * Symptomet i prod: "knappar fungerar inte första gången" och text inskriven
 * direkt efter laddning försvann. Orsaken var React #418: förrenderad HTML
 * (alltid ljust läge) skilde sig från klientens första rendering i en
 * webbläsare med mörkt läge, så React kastade trädet och renderade om — och
 * händelser under tiden tappades.
 *
 * Specen kör i båda färgscheman och med sparat tema, fäller på varje #418 i
 * konsolen, och klickar direkt när knappen syns.
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

/** Samla hydreringsfel (minifierat #418 eller dev-varianten) under sidans liv. */
function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  const isHydration = (text: string): boolean => /#418|#423|#425|hydrat/i.test(text);
  page.on("pageerror", (e) => { if (isHydration(e.message)) errors.push(e.message); });
  page.on("console", (m) => { if (m.type() === "error" && isHydration(m.text())) errors.push(m.text()); });
  return errors;
}

const PAGES = ["/", "/matters/", "/contacts/", "/login/", "/settings/"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`färgschema ${colorScheme}`, () => {
    test.use({ colorScheme });

    for (const path of PAGES) {
      test(`${path} hydrerar utan skillnad`, async ({ page }) => {
        const errors = collectHydrationErrors(page);
        await seedDemoLogin(page, BASE);
        await page.goto(`${BASE}${path}`);
        await page.waitForLoadState("networkidle");
        expect(errors, `hydreringsfel på ${path}`).toEqual([]);
      });
    }
  });
}

test.describe("sparat mörkt tema (ava.theme)", () => {
  test("ingen skillnad och temat gäller efter laddning", async ({ page }) => {
    const errors = collectHydrationErrors(page);
    await page.addInitScript(() => { localStorage.setItem("ava.theme", "dark"); });
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/contacts/`);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("button", { name: "Byt till ljust läge" })).toBeVisible();
  });
});

test.describe("första klicket (mörkt läge)", () => {
  test.use({ colorScheme: "dark" });

  test("'+ Ny kontakt' öppnar formuläret på första klicket, och texten stannar", async ({ page }) => {
    const errors = collectHydrationErrors(page);
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/contacts/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ Ny kontakt" }).click();
    const name = page.getByLabel("Namn *");
    await expect(name).toBeVisible({ timeout: 5_000 });
    await name.fill("Första försöket");
    await page.waitForLoadState("networkidle");
    await expect(name).toHaveValue("Första försöket");
    expect(errors).toEqual([]);
  });
});
