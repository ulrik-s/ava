/**
 * Klientens keepalive sparar proxyns förnyade session (#1425) — mot den
 * RIKTIGA stacken: prod-Caddyfile:n framför oauth2-proxy och Keycloak.
 *
 * `/api` går i prod via Caddys `forward_auth` → `/oauth2/auth`. Vid 2xx når
 * auth-svarets `Set-Cookie` aldrig browsern, så efter COOKIE_REFRESH förnyar
 * proxyn mot IdP:n på VARJE API-anrop utan att spara. Appen frågar därför
 * `/oauth2/userinfo` med jämna mellanrum (och när nätet kommer tillbaka eller
 * fliken blir synlig) — den vägen går via `reverse_proxy` och får med den
 * förnyade cookien.
 *
 * Appen servas av web-containern (:8080, `/oauth2/*` proxas rakt igenom);
 * API-anropen går genom prod-Caddyn (:8082) till en eko-server. Cookien är
 * host-bunden (localhost), så browsern skickar den till båda portarna.
 *
 * Keepalive:n triggas med en riktig `online`-händelse — ingen test-krok i
 * appen. Proxyn loggar `Refreshing session - User: …` per förnyelse; testet
 * räknar raderna i containerns logg (OIDC_PROXY_CONTAINER, satt av e2e-oidc.sh).
 */

import { spawnSync } from "node:child_process";

import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { expect, test } from "../_helper-isolation";
import { onKeycloak, seedCachedIdentity, submitKeycloakLogin, USERS } from "./oidc-helpers";

const CADDY = process.env.AVA_OIDC_CADDY_URL ?? "http://localhost:8082";
/** OAUTH2_PROXY_COOKIE_REFRESH i tooling/docker/docker-compose.oidc.yml. */
const COOKIE_REFRESH_MS = 60_000;
const API_CALLS = 5;

// Service workern får inte stå mellan appen och proxyn.
test.use({ serviceWorkers: "block" });

/** Antal förnyelser oauth2-proxy loggat sedan `since`. */
function refreshesSince(since: Date): number {
  const container = process.env.OIDC_PROXY_CONTAINER;
  if (!container) throw new Error("OIDC_PROXY_CONTAINER saknas — kör via tooling/scripts/e2e-oidc.sh");
  const logs = spawnSync("docker", ["logs", "--since", since.toISOString(), container], { encoding: "utf8" });
  if (logs.status !== 0) throw new Error(`docker logs misslyckades: ${logs.stderr}`);
  return `${logs.stdout}${logs.stderr}`.match(/Refreshing session - User:/g)?.length ?? 0;
}

/** Proxyns sessionscookie (ev. delad i `_oauth2_proxy_0`/`_1`). */
async function sessionCookie(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => c.name.startsWith("_oauth2_proxy"));
  return parts.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join("|");
}

/** `n` tRPC-anrop genom prod-Caddyn; eko-servern svarar med e-posten forward_auth släppte igenom. */
async function callApi(request: APIRequestContext, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = await request.get(`${CADDY}/api/trpc/system.ping`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe(USERS.admin.email);
  }
}

test.describe("Sessions-keepalive genom prod-Caddyns forward_auth (#1425)", () => {
  test("utan session → /api nekas av forward_auth (401)", async ({ request }) => {
    expect((await request.get(`${CADDY}/api/trpc/system.ping`, { maxRedirects: 0 })).status()).toBe(401);
  });

  test("keepalive:n sparar förnyelsen — sedan förnyar /api inte på varje anrop", async ({ page }) => {
    test.setTimeout(COOKIE_REFRESH_MS + 150_000);
    // Den cachade identiteten (samma e-post) → grinden släpper in direkt efter inloggningen.
    await seedCachedIdentity(page, 0);
    await page.goto(`/oauth2/start?rd=${encodeURIComponent("/ava/")}`);
    await submitKeycloakLogin(page, USERS.admin.username, USERS.admin.password);
    await page.waitForURL((u) => !onKeycloak(u));
    await expect(page.getByTestId("sync-pill")).toBeVisible(); // appträdet (med keepalive:n) är monterat
    await callApi(page.request, 1);
    const initial = await sessionCookie(page.context());
    expect(initial).not.toBe("");

    await page.waitForTimeout(COOKIE_REFRESH_MS + 5_000);

    // Felet i #1425: varje /api-anrop förnyar mot IdP:n, och inget sparas.
    const beforeKeepalive = new Date();
    await callApi(page.request, 2);
    await expect.poll(() => refreshesSince(beforeKeepalive)).toBeGreaterThanOrEqual(2);
    expect(await sessionCookie(page.context())).toBe(initial);

    // Nätet tillbaka → keepalive:n frågar /oauth2/userinfo → den förnyade cookien når browsern.
    const userinfo = page.waitForResponse((r) => new URL(r.url()).pathname === "/oauth2/userinfo");
    await page.evaluate(() => { window.dispatchEvent(new Event("online")); });
    expect((await userinfo).status()).toBe(200);
    await expect.poll(() => sessionCookie(page.context())).not.toBe(initial);

    // Sessionen är färsk igen: inga fler förnyelser via forward_auth.
    const afterKeepalive = new Date();
    await callApi(page.request, API_CALLS);
    await page.waitForTimeout(1_000); // ge en ev. sen loggrad tid att komma
    expect(refreshesSince(afterKeepalive)).toBe(0);
  });
});
