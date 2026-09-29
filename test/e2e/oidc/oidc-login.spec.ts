/**
 * OIDC-login-e2e (#222) — riktig browser-token-dans mot Keycloak.
 *
 * Stacken (web + oauth2-proxy + Keycloak realm "ava") körs av
 * tooling/scripts/e2e-oidc.sh. Testerna driver Keycloaks RIKTIGA login-formulär
 * i en RIKTIG browser (Playwright `page`). Browsern hanterar Keycloaks state-/
 * session-cookies nativt — programmatisk form-POST mot login-actions/authenticate
 * ger annars 400 "No state cookie" (Keycloak#12240); login-formuläret är ett
 * browser-flöde. Detta verifierar hela code-exchangen (inkl. oauth2-proxy:s
 * backchannel + aud-claim) end-to-end, vilket en mock-IdP inte kan.
 *
 * Regressionsbatteri: inloggning (flera användare), fel lösenord, utloggning,
 * skydd utan session. Sedan #1245 skyddar proxyn bara data (`/api`, `/git`) —
 * skalet laddas fritt och klienten själv skickar en utloggad användare till
 * `/oauth2/start`.
 */

import { test, expect, type Page } from "@playwright/test";

const USERS = {
  admin: { username: "admin", password: "admin", email: "admin@ava.test" },
  lawyer: { username: "lawyer", password: "lawyer", email: "lawyer@ava.test" },
};

const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;
const onKeycloak = (u: URL): boolean => AUTHORIZE_RE.test(u.toString());

/** Driv Keycloaks login-formulär i browsern; vänta tillbaka till appen. */
async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE); // oauth2-proxy → Keycloak authorize → login-sida
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
}

test.describe("OIDC-login mot Keycloak", () => {
  test("oautentiserad → redirectas till Keycloak-login", async ({ page }) => {
    await page.goto("/ava/");
    await page.waitForURL(AUTHORIZE_RE);
    await expect(page.locator("#kc-form-login")).toBeVisible();
  });

  // #1245: skalet (statiska filer utan data) laddas utan inloggning — så att
  // appen startar vid ett IdP-avbrott. Det är APPEN som skickar en utloggad
  // användare till inloggningen (testet ovan); data kräver fortfarande session.
  test("app-skalet laddas utan inloggning; /git kräver session (#1245)", async ({ page }) => {
    const shell = await page.request.get("/ava/", { maxRedirects: 0 });
    expect(shell.status()).toBe(200);
    expect(await shell.text()).toContain("<html");
    const git = await page.request.get("/git/firma.git/info/refs?service=git-upload-pack", { maxRedirects: 0 });
    expect(git.status()).toBe(401);
  });

  test("admin loggar in → session + userinfo ger rätt email", async ({ page }) => {
    await login(page, USERS.admin.username, USERS.admin.password);
    await page.waitForURL((u) => !onKeycloak(u)); // tillbaka på appen
    const resp = await page.request.get("/oauth2/userinfo");
    expect(resp.status()).toBe(200);
    expect(((await resp.json()) as { email?: string }).email).toBe(USERS.admin.email);
  });

  test("annan användare (lawyer) loggar in → rätt email", async ({ page }) => {
    await login(page, USERS.lawyer.username, USERS.lawyer.password);
    await page.waitForURL((u) => !onKeycloak(u));
    const info = (await (await page.request.get("/oauth2/userinfo")).json()) as { email?: string };
    expect(info.email).toBe(USERS.lawyer.email);
  });

  test("fel lösenord → stannar på Keycloak, ingen session", async ({ page }) => {
    await login(page, USERS.admin.username, "fel-lösenord");
    // Kvar på Keycloak med login-formuläret (ej redirectad till appen).
    await expect(page).toHaveURL(/realms\/ava/);
    await expect(page.locator("#kc-form-login")).toBeVisible();
    // Ingen oauth2-proxy-session etablerades.
    expect((await page.request.get("/oauth2/userinfo")).status()).toBe(401);
  });

  test("ingen session → /oauth2/userinfo nekas (401)", async ({ page }) => {
    expect((await page.request.get("/oauth2/userinfo")).status()).toBe(401);
  });

  test("utloggning → oauth2-proxy-session upphör (userinfo 401)", async ({ page }) => {
    await login(page, USERS.admin.username, USERS.admin.password);
    await page.waitForURL((u) => !onKeycloak(u));
    expect((await page.request.get("/oauth2/userinfo")).status()).toBe(200); // inloggad
    // Rensa proxy-sessionen UTAN att följa redirecten: sign_out → /ava/ →
    // Keycloak-SSO (sessionen lever kvar) skulle annars auto-re-autha. Vi
    // verifierar proxy-logouten; full SSO-logout är en separat sak.
    await page.request.get("/oauth2/sign_out", { maxRedirects: 0 });
    expect((await page.request.get("/oauth2/userinfo")).status()).toBe(401); // utloggad ur proxyn
  });
});
