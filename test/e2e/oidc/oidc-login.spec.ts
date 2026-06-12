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
function loginActionUrl(html: string, ctxInfo: string): string {
  // Keycloak 26: <form ... action="…/login-actions/authenticate?…">. Var
  // tolerant mot tema-variationer — matcha valfri authenticate-action.
  const m = html.match(/action="([^"]*authenticate[^"]*)"/i);
  if (!m) {
    throw new Error(
      `hittade inte Keycloak-login-formulärets action (${ctxInfo}); html[0..300]=` +
        html.slice(0, 300).replace(/\s+/g, " "),
    );
  }
  return m[1]!.replace(/&amp;/g, "&");
}

/**
 * Kör hela login-flödet i en isolerad cookie-jar. Explicita hopp (kontroll +
 * felsökbarhet): /oauth2/start (302→Keycloak authorize) → GET authorize
 * (login-HTML + KC-cookies) → POST credentials → callback → oauth2-proxy-session.
 */
interface LoginResult {
  ctx: APIRequestContext;
  /** Diagnostik-spår (visas i assert-meddelandet vid fel). */
  trace: string;
}

async function login(username: string, password: string): Promise<LoginResult> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  // 1. Starta → oauth2-proxy sätter CSRF-cookie + 302 till Keycloak authorize.
  const start = await ctx.get("/oauth2/start?rd=%2Fava%2F", { maxRedirects: 0 });
  const authorizeUrl = start.headers()["location"];
  if (!authorizeUrl) {
    throw new Error(`/oauth2/start gav ingen redirect (status ${start.status()})`);
  }
  // 2. GET authorize → Keycloaks login-sida (sätter AUTH_SESSION-cookies).
  const loginPage = await ctx.get(authorizeUrl);
  const action = loginActionUrl(
    await loginPage.text(),
    `status ${loginPage.status()} url ${loginPage.url()}`,
  );
  // 3. POST credentials → Keycloak 302 → callback?code=… (explicit hopp).
  const post = await ctx.post(action, {
    form: { username, password, credentialId: "" },
    maxRedirects: 0,
  });
  const callbackUrl = post.headers()["location"];
  // 4. GET callback → oauth2-proxy redeemar code (backchannel) → sätter
  //    session-cookie → 302 /ava/. (Vid fel lösenord saknas callback.)
  let cbStatus = "—";
  if (callbackUrl) {
    const cb = await ctx.get(callbackUrl, { maxRedirects: 0 });
    cbStatus = String(cb.status());
  }
  const cookies = (await ctx.storageState()).cookies.map((c) => c.name).join(",");
  let postBody = "";
  if (post.status() >= 400) {
    const t = await post.text();
    const err = t.match(/(Invalid username or password|timed out|Cookie not found|We are sorry|kc-error-message[^<]*|<title>[^<]*<\/title>)/i);
    postBody = ` postBody="${(err?.[0] ?? t.slice(0, 120)).replace(/\s+/g, " ")}"`;
  }
  const trace = `post=${post.status()} cb=${cbStatus} cbUrl=${callbackUrl ? "ja" : "nej"} cookies=[${cookies}]${postBody}`;
  return { ctx, trace };
}

test.describe("OIDC-login mot Keycloak (token-dans)", () => {
  test("admin loggar in → session + userinfo ger rätt email", async () => {
    const { ctx, trace } = await login(USERS.admin.username, USERS.admin.password);
    const resp = await ctx.get("/oauth2/userinfo");
    expect(resp.status(), trace).toBe(200);
    expect(((await resp.json()) as { email?: string }).email).toBe(USERS.admin.email);
    await ctx.dispose();
  });

  test("annan användare (lawyer) loggar in → rätt email", async () => {
    const { ctx, trace } = await login(USERS.lawyer.username, USERS.lawyer.password);
    const resp = await ctx.get("/oauth2/userinfo");
    expect(resp.status(), trace).toBe(200);
    expect(((await resp.json()) as { email?: string }).email).toBe(USERS.lawyer.email);
    await ctx.dispose();
  });

  test("fel lösenord → ingen session (userinfo 401)", async () => {
    const { ctx } = await login(USERS.admin.username, "fel-lösenord");
    expect((await ctx.get("/oauth2/userinfo")).status()).toBe(401);
    await ctx.dispose();
  });

  test("ingen session → /oauth2/userinfo nekas (401)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    expect((await ctx.get("/oauth2/userinfo")).status()).toBe(401);
    await ctx.dispose();
  });

  test("utloggning → session upphör (userinfo 401 efteråt)", async () => {
    const { ctx, trace } = await login(USERS.admin.username, USERS.admin.password);
    expect((await ctx.get("/oauth2/userinfo")).status(), trace).toBe(200); // inloggad
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
