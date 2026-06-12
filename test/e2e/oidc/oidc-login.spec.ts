/**
 * OIDC-login-e2e (#222) — riktig browser-token-dans mot Keycloak.
 *
 * Stacken (web + oauth2-proxy + Keycloak realm "ava") körs av
 * tooling/scripts/e2e-oidc.sh. Testerna driver Keycloaks RIKTIGA login-formulär
 * och verifierar oauth2-proxy-sessionen end-to-end — det som mock-OIDC inte kan.
 *
 * Regressionsbatteri: inloggning (flera användare), fel lösenord, utloggning,
 * skydd utan session, och att appen + /git/ gat:as bakom auth.
 */

import { test, expect, type Page } from "@playwright/test";

const USERS = {
  admin: { username: "admin", password: "admin", email: "admin@ava.test" },
  lawyer: { username: "lawyer", password: "lawyer", email: "lawyer@ava.test" },
};

const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;

/** Fyll i Keycloaks login-formulär och vänta tillbaka till appen. */
async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE); // redirectad till Keycloak
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
}

test.describe("OIDC-login mot Keycloak", () => {
  test("oautentiserad → redirectas till Keycloak-login", async ({ page }) => {
    await page.goto("/ava/");
    await page.waitForURL(AUTHORIZE_RE);
    await expect(page.locator("#kc-form-login, #username")).toBeVisible();
  });

  test("admin loggar in → session + userinfo ger rätt email", async ({ page }) => {
    await login(page, USERS.admin.username, USERS.admin.password);
    // Tillbaka på appen (inte längre på Keycloak).
    await page.waitForURL((u) => !AUTHORIZE_RE.test(u.toString()));
    const resp = await page.request.get("/oauth2/userinfo");
    expect(resp.status()).toBe(200);
    const info = (await resp.json()) as { email?: string };
    expect(info.email).toBe(USERS.admin.email);
  });

  test("annan allowlist-kandidat (lawyer) loggar in → rätt email", async ({ page }) => {
    await login(page, USERS.lawyer.username, USERS.lawyer.password);
    await page.waitForURL((u) => !AUTHORIZE_RE.test(u.toString()));
    const info = (await (await page.request.get("/oauth2/userinfo")).json()) as { email?: string };
    expect(info.email).toBe(USERS.lawyer.email);
  });

  test("fel lösenord → stannar på Keycloak med fel", async ({ page }) => {
    await login(page, USERS.admin.username, "fel-lösenord");
    await expect(page).toHaveURL(/realms\/ava/);
    await expect(page.locator("#input-error, .kc-feedback-text, .alert-error, .pf-c-alert")).toBeVisible();
  });

  test("ingen session → /oauth2/userinfo nekas (401)", async ({ page }) => {
    const resp = await page.request.get("/oauth2/userinfo");
    expect(resp.status()).toBe(401);
  });

  test("utloggning → /ava/ kräver login igen", async ({ page }) => {
    await login(page, USERS.admin.username, USERS.admin.password);
    await page.waitForURL((u) => !AUTHORIZE_RE.test(u.toString()));
    // Logga ut via oauth2-proxy.
    await page.goto("/oauth2/sign_out");
    // Ny åtkomst → tillbaka till Keycloak-login.
    await page.goto("/ava/");
    await page.waitForURL(AUTHORIZE_RE);
  });
});
