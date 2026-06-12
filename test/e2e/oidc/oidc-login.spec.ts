/**
 * OIDC-login-e2e (#222) — riktig token-dans mot Keycloak.
 *
 * Stacken (web + oauth2-proxy + Keycloak realm "ava") körs av
 * tooling/scripts/e2e-oidc.sh. Testerna kör hela OIDC-flödet via Playwrights
 * `request`-context (Node-sidans cookie-jar): authorize → Keycloaks login →
 * callback → oauth2-proxy-session → /oauth2/userinfo. Det verifierar den
 * fulla code-exchangen (inkl. oauth2-proxy:s backchannel mot Keycloak) som en
 * mock-IdP inte kan — och är robustare än browser-navigering (ingen
 * Chromium↔Docker-port-flakighet).
 *
 * Regressionsbatteri: inloggning (flera användare), fel lösenord, utloggning,
 * skydd utan session.
 */

import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

const BASE = process.env.AVA_OIDC_BASE_URL ?? "http://127.0.0.1:8088";

const USERS = {
  admin: { username: "admin", password: "admin", email: "admin@ava.test" },
  lawyer: { username: "lawyer", password: "lawyer", email: "lawyer@ava.test" },
};

/** Plocka ut Keycloak-login-formulärets action-URL ur login-HTML:en. */
function loginActionUrl(html: string): string {
  const m = html.match(/action="([^"]*login-actions\/authenticate[^"]*)"/);
  if (!m) throw new Error("hittade inte Keycloak-login-formulärets action");
  return m[1]!.replace(/&amp;/g, "&");
}

/**
 * Kör hela login-flödet i en isolerad cookie-jar. Returnerar contexten (med
 * session-cookien om login lyckades) — caller verifierar via /oauth2/userinfo.
 */
async function login(username: string, password: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  // 1. /oauth2/start → följer redirects → Keycloaks login-sida (cookies fångas).
  const startHtml = await (await ctx.get("/oauth2/start?rd=%2Fava%2F")).text();
  const action = loginActionUrl(startHtml);
  // 2. POST credentials → Keycloak → (lyckad) 302 callback → oauth2-proxy redeem
  //    → session-cookie → 302 /ava/. request följer redirects automatiskt.
  await ctx.post(action, {
    form: { username, password, credentialId: "" },
  });
  return ctx;
}

test.describe("OIDC-login mot Keycloak (token-dans)", () => {
  test("admin loggar in → session + userinfo ger rätt email", async () => {
    const ctx = await login(USERS.admin.username, USERS.admin.password);
    const resp = await ctx.get("/oauth2/userinfo");
    expect(resp.status()).toBe(200);
    expect(((await resp.json()) as { email?: string }).email).toBe(USERS.admin.email);
    await ctx.dispose();
  });

  test("annan användare (lawyer) loggar in → rätt email", async () => {
    const ctx = await login(USERS.lawyer.username, USERS.lawyer.password);
    const info = (await (await ctx.get("/oauth2/userinfo")).json()) as { email?: string };
    expect(info.email).toBe(USERS.lawyer.email);
    await ctx.dispose();
  });

  test("fel lösenord → ingen session (userinfo 401)", async () => {
    const ctx = await login(USERS.admin.username, "fel-lösenord");
    expect((await ctx.get("/oauth2/userinfo")).status()).toBe(401);
    await ctx.dispose();
  });

  test("ingen session → /oauth2/userinfo nekas (401)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    expect((await ctx.get("/oauth2/userinfo")).status()).toBe(401);
    await ctx.dispose();
  });

  test("utloggning → session upphör (userinfo 401 efteråt)", async () => {
    const ctx = await login(USERS.admin.username, USERS.admin.password);
    expect((await ctx.get("/oauth2/userinfo")).status()).toBe(200); // inloggad
    await ctx.get("/oauth2/sign_out");
    expect((await ctx.get("/oauth2/userinfo")).status()).toBe(401); // utloggad
    await ctx.dispose();
  });

  test("redirect: oskyddad /ava/ → 302 mot Keycloak authorize", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    const resp = await ctx.get("/ava/", { maxRedirects: 0 });
    expect(resp.status()).toBe(302);
    // /ava/ → /oauth2/start (oauth2-proxy bygger sedan authorize-URL:en).
    expect(resp.headers()["location"]).toContain("/oauth2/start");
    await ctx.dispose();
  });
});
