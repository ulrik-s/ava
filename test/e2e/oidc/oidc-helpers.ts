/**
 * Delat för OIDC-specarna: test-användarna, inloggningen mot test-realmens
 * RIKTIGA Keycloak-formulär och en cachad identitet i firma-config.
 *
 * Browsern hanterar Keycloaks state-/session-cookies nativt — programmatisk
 * form-POST mot login-actions/authenticate ger annars 400 "No state cookie"
 * (Keycloak#12240); login-formuläret är ett browser-flöde.
 */

import type { Page } from "@playwright/test";

/** Test-användarna i tooling/docker/keycloak/realm-ava.json. */
export const USERS = {
  admin: { username: "admin", password: "admin", email: "admin@ava.test" },
  lawyer: { username: "lawyer", password: "lawyer", email: "lawyer@ava.test" },
} as const;

/** Keycloaks authorize-/login-sida. */
export const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;

/** Står browsern på Keycloaks login? */
export const onKeycloak = (u: URL): boolean => AUTHORIZE_RE.test(u.toString());

/** Fyll i och skicka Keycloaks login-formulär (browsern står på det). */
export async function submitKeycloakLogin(page: Page, username: string, password: string): Promise<void> {
  await page.waitForURL(AUTHORIZE_RE);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
}

/** Driv Keycloaks login-formulär i browsern (appen → oauth2-proxy → Keycloak). */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await submitKeycloakLogin(page, username, password);
}

/** Lägg en cachad identitet (admin) i firma-config innan appen kör — som efter en tidigare inloggning. */
export async function seedCachedIdentity(page: Page, verifiedAgoMs: number): Promise<void> {
  await page.addInitScript((verifiedAt: number) => {
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "self-hosted",
      organizationId: "00000000-0000-0000-0000-000000000001",
      principalId: "00000000-0000-0000-0000-0000000000a1",
      authorEmail: "admin@ava.test",
      authorName: "Admin",
      sessionVerifiedAt: verifiedAt,
    }));
  }, Date.now() - verifiedAgoMs);
}
