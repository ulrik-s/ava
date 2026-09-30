/**
 * Inloggning mot den fulla self-hosted-stacken (Keycloak → oauth2-proxy →
 * appen), delad av specarna i den här katalogen.
 */
import type { Page } from "@playwright/test";

const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;
const onKeycloak = (u: URL): boolean => AUTHORIZE_RE.test(u.toString());
/** Tillbaka i appen — inte på `/oauth2/callback`, som omdirigerar vidare till `/ava/`. */
const inApp = (u: URL): boolean => !onKeycloak(u) && u.pathname.startsWith("/ava/");

/** Driv Keycloaks login-formulär i browsern; vänta tillbaka till appen. */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  // Att bara vänta på att Keycloak är lämnat släpper på callbacken, och då
  // krockar specens nästa `page.goto` med omdirigeringen till `/ava/`.
  await page.waitForURL(inApp);
}
