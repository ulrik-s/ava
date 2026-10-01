/**
 * Sessionsförnyelse genom prod-Caddyn (#1425) — mot den RIKTIGA stacken
 * (prod-Caddyfile + oauth2-proxy + Keycloak).
 *
 * `/api` går via Caddys `forward_auth` → `/oauth2/auth`. Vid 2xx kopierar Caddy
 * bara `copy_headers` in i upstream-anropet; auth-svarets `Set-Cookie` når
 * aldrig browsern. Med sessionen i cookien gick därför varje förnyelse förlorad,
 * och efter COOKIE_REFRESH förnyade proxyn mot IdP:n på VARJE API-anrop. Med
 * sessionen i redis (biljett i cookien) sparas förnyelsen på serversidan: EN
 * förnyelse, sedan inga fler förrän nästa intervall.
 *
 * Proxyn loggar `Refreshing session - User: …` per förnyelse; testet räknar
 * raderna i containerns logg (OIDC_PROXY_CONTAINER, satt av e2e-oidc.sh).
 */

import { spawnSync } from "node:child_process";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { expect, test } from "../_helper-isolation";
import { login, onKeycloak, USERS } from "./keycloak-login";

const CADDY = process.env.AVA_OIDC_CADDY_URL ?? "http://localhost:8082";
/** OAUTH2_PROXY_COOKIE_REFRESH i tooling/docker/docker-compose.oidc.yml. */
const COOKIE_REFRESH_MS = 60_000;
const API_CALLS_AFTER_REFRESH = 5;

/** Antal förnyelser oauth2-proxy loggat sedan `since`. */
function refreshesSince(since: Date): number {
  const container = process.env.OIDC_PROXY_CONTAINER;
  if (!container) throw new Error("OIDC_PROXY_CONTAINER saknas — kör via tooling/scripts/e2e-oidc.sh");
  const logs = spawnSync("docker", ["logs", "--since", since.toISOString(), container], { encoding: "utf8" });
  if (logs.status !== 0) throw new Error(`docker logs misslyckades: ${logs.stderr}`);
  return `${logs.stdout}${logs.stderr}`.match(/Refreshing session - User:/g)?.length ?? 0;
}

/** Ett tRPC-anrop genom prod-Caddyn (api-echo svarar med den e-post servern fick). */
const callApi = (request: APIRequestContext): Promise<APIResponse> =>
  request.get(`${CADDY}/api/trpc/system.ping`, { maxRedirects: 0 });

test.describe("Sessionsförnyelse genom prod-Caddyns forward_auth (#1425)", () => {
  test("utan session → /api nekas av forward_auth (401)", async ({ request }) => {
    expect((await callApi(request)).status()).toBe(401);
  });

  test("efter COOKIE_REFRESH förnyas sessionen EN gång — inte på varje API-anrop", async ({ page }) => {
    test.setTimeout(COOKIE_REFRESH_MS + 120_000);
    await login(page, USERS.admin.username, USERS.admin.password);
    await page.waitForURL((u) => !onKeycloak(u));
    // Appen får inte göra egna anrop (t.ex. /oauth2/userinfo) under väntan.
    await page.goto("about:blank");

    const first = await callApi(page.request);
    expect(first.status()).toBe(200);
    expect(await first.text()).toBe(USERS.admin.email); // copy_headers med verifierad e-post

    const since = new Date();
    await page.waitForTimeout(COOKIE_REFRESH_MS + 5_000);
    for (let i = 0; i < API_CALLS_AFTER_REFRESH; i++) {
      const res = await callApi(page.request);
      expect(res.status()).toBe(200);
      expect(await res.text()).toBe(USERS.admin.email);
    }
    // Exakt en: förnyelsen skedde (>= 1) och sparades (<= 1). Med sessionen i
    // cookien blev det en per anrop.
    expect(refreshesSince(since)).toBe(1);
  });
});
