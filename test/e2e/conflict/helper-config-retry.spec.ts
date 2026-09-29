/**
 * Webbappen konfigurerar AVA Helper, och försöker igen om första försöket
 * misslyckas (#1161, #1149). Körs mot hela stacken, där servern exponerar sin
 * OIDC-config via `system.helperConfig`.
 *
 * Buggen från piloten mot ava-crm.io: helpern satt kvar med en gammal config
 * (Keycloak från dev) och inloggningen föll med "fetch failed". Webbappen hade
 * markerat pushen som gjord INNAN den skickades. Första `POST /config`
 * misslyckades medan helpern väntade på att användaren skulle godkänna
 * webbplatsen ("Tillåt"), och fliken försökte aldrig igen.
 *
 * Helpern fejkas i webbläsaren med `page.route`, via bas-overriden
 * `ava.helperBase`, så ingen riktig helper behövs. Första `POST /config`
 * avbryts och andra besvaras. Webbappen ska då försöka igen, med serverns
 * config.
 */
import { test, expect, type Route } from "@playwright/test";
import { login } from "./_selfhosted-login";

const FAKE_HELPER = "http://127.0.0.1:48799";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

test.use({ serviceWorkers: "block" }); // page.route ser inte förfrågningar som går via appens service worker

test("misslyckad config-push till helpern försöks igen — med serverns inloggnings-config", async ({ page }) => {
  test.setTimeout(90_000);
  const pushes: Array<Record<string, unknown>> = [];
  await page.route(`${FAKE_HELPER}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path === "/config") {
      pushes.push(JSON.parse(req.postData() ?? "{}") as Record<string, unknown>);
      // Första försöket: helpern väntar på "Tillåt" → webbappens anrop avbryts.
      if (pushes.length === 1) return route.abort("timedout");
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) });
    }
    if (path === "/ping") return route.fulfill({ status: 200, headers: CORS, body: "ava-helper v0.2.0\n" });
    return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ pending: 0, conflict: 0, total: 0, entries: [] }) });
  });
  await page.addInitScript((base) => {
    try { localStorage.setItem("ava.helperBase", base); } catch { /* privat läge */ }
  }, FAKE_HELPER);

  await login(page, "lawyer", "lawyer");
  await expect.poll(() => pushes.length, { timeout: 60_000, message: "webbappen ska försöka igen efter ett misslyckat försök" }).toBe(2);
  expect(pushes[1]).toMatchObject({ oidcIssuer: expect.stringMatching(/\/realms\/ava$/), oidcClientId: "ava-helper" });

  // Klart när helpern tagit emot configen — inga fler försök.
  await page.waitForTimeout(17_000);
  expect(pushes).toHaveLength(2);
});
