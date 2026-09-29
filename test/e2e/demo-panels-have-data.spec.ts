/**
 * E2E (demo): varje panel och flik i varje menyval visar data (#1314).
 *
 * Demon hade tomma paneler: Inställningar → Kontor, Dokument-etiketter och
 * Standardvyer; Händelser och Förslag i de flesta ärenden; Domstolsbetalningar i
 * brottmålen; och åldersanalysen i Kundfordringar (inga fakturor hade
 * förfallodatum). Testet klickar igenom varje flik och fäller på ett tomläge.
 *
 * Ärendena är ett urval — ett per betalningssätt och ett avslutat — så att
 * testet håller sig kort; `simulate-orchestrate.test.ts` påstår samma sak om
 * VARJE ärende i demodatan.
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, seedDemoLogin, test, expect, type DemoSeed } from "./_demo-test";

/** Appens tomlägen ("Inga … ännu.", "Laddar …", "Välj jurist och period."). */
const EMPTY_STATE = /Inga [^.]{0,60}(ännu|registrerade|hittade|satta)[^.]*\.|Inga [a-zåäö ]{2,40}\.|Laddar|Välj jurist/;

const MENU = ["/", "/conflicts/", "/matters/", "/watchlist/", "/calendar/", "/contacts/", "/search/", "/templates/",
  "/time/", "/reports/", "/invoices/", "/payment-plans/", "/users/", "/profile/", "/settings/"];

type SeedMatter = DemoSeed["matters"][number];

/** Ett ärende per betalningssätt, plus ett som inte är aktivt. */
function sampleMatters(matters: readonly SeedMatter[]): SeedMatter[] {
  const byMethod = new Map<string, SeedMatter>();
  for (const m of matters) {
    const method = m.paymentMethod ?? "";
    if (m.status === "ACTIVE" && !byMethod.has(method)) byMethod.set(method, m);
  }
  const closed = matters.find((m) => m.status !== "ACTIVE");
  return [...byMethod.values(), ...(closed ? [closed] : [])];
}

/** Varje flik på sidan: [titel, text i dess panel]. Sidor utan flikar: hela huvudytan. */
async function panelTexts(page: Page): Promise<Array<[string, string]>> {
  const tabs = page.locator(".dv-tab");
  const n = await tabs.count();
  if (n === 0) return [["sidan", await page.locator("main").innerText()]];
  const out: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    const tab = tabs.nth(i);
    const title = (await tab.innerText()).trim();
    await tab.click();
    const panel = tab.locator("xpath=ancestor::div[contains(@class,'dv-groupview')][1]").locator(".dv-content-container");
    await expect(panel).not.toHaveText(/Laddar/, { timeout: 15_000 });
    out.push([title, await panel.innerText()]);
  }
  return out;
}

async function expectNoEmptyPanels(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 30_000 });
  // Sidan är klar när inget längre laddar (dockytan laddas efter sidhuvudet).
  await expect(page.locator("main")).not.toContainText("Laddar", { timeout: 30_000 });
  for (const [title, text] of await panelTexts(page)) {
    expect(text.match(EMPTY_STATE)?.[0], `${path} — ${title}`).toBeUndefined();
  }
}

test.describe("varje panel har data", () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seedDemoLogin(page, BASE);
  });

  test("menyvalen", async ({ page }) => {
    for (const path of MENU) await expectNoEmptyPanels(page, path);
  });

  test("ärendena — ett per betalningssätt och ett avslutat", async ({ page }) => {
    const seed = await fetchDemoSeed(page, BASE);
    const matters = sampleMatters(seed.matters);
    expect(matters.length).toBeGreaterThanOrEqual(5);
    for (const m of matters) await expectNoEmptyPanels(page, `/matters/${m.id}/`);
  });
});
