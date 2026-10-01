/**
 * IdP nere (#1351) — mot den RIKTIGA stacken (oauth2-proxy + Keycloak).
 *
 * En användare som loggat in på enheten (cachad identitet, verifierad inom
 * offline-graceperioden) ska kunna starta appen när inloggningen inte går att
 * förnya: appen startar lokalt med bannern "Logga in igen" — ingen hård
 * omdirigering till en IdP som inte svarar, och ingen omdirigeringsloop.
 *
 * "IdP nere" = browsern når inte Keycloak (alla anrop dit avbryts). Proxyn
 * har ingen session för den nya browser-kontexten och svarar 401 på
 * `/oauth2/userinfo` — precis det läge en användare hamnar i när sessionen
 * gått ut och IdP:n inte kan förnya den. Proxyavbrott (anslutningen bryts)
 * och en proxy som aldrig svarar (timeout) prövas också.
 */

import type { Page } from "@playwright/test";

import { expect, test } from "../_helper-isolation";
import { AUTHORIZE_RE, seedCachedIdentity } from "./oidc-helpers";

const KEYCLOAK_ORIGIN = new URL(process.env.OIDC_KC_HOSTNAME ?? "http://localhost:8089").origin;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Service workern får inte gå förbi page.route (den skulle se andra svar än testet styr).
test.use({ serviceWorkers: "block" });

/** IdP:n nere: varje anrop till Keycloak avbryts. Returnerar de försök som gjordes. */
async function idpDown(page: Page): Promise<string[]> {
  const attempts: string[] = [];
  await page.route(`${KEYCLOAK_ORIGIN}/**`, async (route) => {
    attempts.push(route.request().url());
    await route.abort("connectionrefused");
  });
  return attempts;
}

/** Alla huvudnavigeringar — för att se att appen aldrig skickar vidare till IdP:n. */
function trackNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) urls.push(frame.url()); });
  return urls;
}

async function expectStartsLocallyWithBanner(page: Page, text: RegExp): Promise<void> {
  const banner = page.getByTestId("reauth-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(text);
  await expect(banner.getByRole("button", { name: "Logga in igen" })).toBeVisible();
}

test.describe("IdP nere inom offline-graceperioden (#1351)", () => {
  test("utgången session + IdP nere → appen startar lokalt med bannern, ingen omdirigering", async ({ page }) => {
    await seedCachedIdentity(page, HOUR);
    const idpAttempts = await idpDown(page);
    const navigations = trackNavigations(page);
    await page.goto("/ava/");
    await expectStartsLocallyWithBanner(page, /Inloggningen har gått ut/);
    // Ge en ev. sen omdirigering (synkens 401-väg, en loop) chansen att visa sig.
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain("/ava/");
    expect(navigations.filter((u) => AUTHORIZE_RE.test(u) || u.includes("/oauth2/start"))).toEqual([]);
    expect(idpAttempts).toEqual([]);
  });

  test("'Logga in igen' går till inloggningen först när användaren klickar", async ({ page }) => {
    await seedCachedIdentity(page, HOUR);
    await idpDown(page);
    await page.goto("/ava/");
    await expectStartsLocallyWithBanner(page, /Inloggningen har gått ut/);
    const start = page.waitForRequest((r) => r.url().includes("/oauth2/start"));
    await page.getByRole("button", { name: "Logga in igen" }).click();
    expect(new URL((await start).url()).searchParams.get("rd")).toBe("/ava/");
  });

  test("proxyn nås inte (anslutningen bryts) → lokalt med bannern", async ({ page }) => {
    await seedCachedIdentity(page, DAY);
    await page.route("**/oauth2/userinfo", (route) => route.abort("connectionrefused"));
    await page.goto("/ava/");
    await expectStartsLocallyWithBanner(page, /gick inte att kontrollera/);
  });

  test("proxyn svarar aldrig → appstarten hänger inte (timeout ~3 s)", async ({ page }) => {
    await seedCachedIdentity(page, DAY);
    await page.route("**/oauth2/userinfo", () => { /* svarar aldrig */ });
    const started = Date.now();
    await page.goto("/ava/");
    await expectStartsLocallyWithBanner(page, /gick inte att kontrollera/);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  test("captive portal (HTML 200) räknas inte som inloggad → lokalt med bannern", async ({ page }) => {
    await seedCachedIdentity(page, DAY);
    await page.route("**/oauth2/userinfo", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html>Logga in på hotellets wifi</html>" }));
    await page.goto("/ava/");
    await expectStartsLocallyWithBanner(page, /gick inte att kontrollera/);
  });

  test("utanför graceperioden → till inloggningen som förut", async ({ page }) => {
    await seedCachedIdentity(page, 8 * DAY);
    await page.goto("/ava/");
    await page.waitForURL(AUTHORIZE_RE);
  });
});
