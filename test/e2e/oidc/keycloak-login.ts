/**
 * Inloggning mot test-realmens RIKTIGA Keycloak-formulär — delad av OIDC-specarna.
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

/** Driv Keycloaks login-formulär i browsern (appen → oauth2-proxy → Keycloak). */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE); // oauth2-proxy → Keycloak authorize → login-sida
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
}
