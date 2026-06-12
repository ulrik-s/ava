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
 * skydd utan session.
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
  test("DIAG: browsern når web-porten direkt (/healthz, ingen redirect)", async ({ page }) => {
    const resp = await page.goto("/healthz");
    expect(resp?.status()).toBe(200);
  });

  test("DIAG: browsern når Keycloak-porten direkt", async ({ page }) => {
    const issuer = process.env.OIDC_ISSUER_PUBLIC ?? "http://localhost:8089/realms/ava";
    const resp = await page.goto(`${issuer}/.well-known/openid-configuration`);
    expect(resp?.status()).toBe(200);
  });

  test("oautentiserad → redirectas till Keycloak-login", async ({ page }) => {
    await page.goto("/ava/");
    await page.waitForURL(AUTHORIZE_RE);
    await expect(page.locator("#kc-form-login")).toBeVisible();
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

  test("fel lösenord → stannar på Keycloak med fel", async ({ page }) => {
    await login(page, USERS.admin.username, "fel-lösenord");
    await expect(page).toHaveURL(/realms\/ava/);
    await expect(page.locator("#input-error, .pf-c-alert, .alert-error, #kc-feedback")).toBeVisible();
  });

  test("ingen session → /oauth2/userinfo nekas (401)", async ({ page }) => {
    expect((await page.request.get("/oauth2/userinfo")).status()).toBe(401);
  });

  test("utloggning → /ava/ kräver login igen", async ({ page }) => {
    await login(page, USERS.admin.username, USERS.admin.password);
    await page.waitForURL((u) => !onKeycloak(u));
    expect((await page.request.get("/oauth2/userinfo")).status()).toBe(200); // inloggad
    await page.goto("/oauth2/sign_out");
    await page.goto("/ava/");
    await page.waitForURL(AUTHORIZE_RE); // utloggad → tillbaka till Keycloak
  });
});
