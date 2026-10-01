/**
 * Inloggning mot den fulla self-hosted-stacken (Keycloak → oauth2-proxy →
 * appen), delad av specarna i den här katalogen.
 */
import type { Page } from "@playwright/test";

const AUTHORIZE_RE = /realms\/ava\/protocol\/openid-connect\/auth/;
const onKeycloak = (u: URL): boolean => AUTHORIZE_RE.test(u.toString());
/** Tillbaka i appen — inte på `/oauth2/callback`, som omdirigerar vidare till `/ava/`. */
const inApp = (u: URL): boolean => !onKeycloak(u) && u.pathname.startsWith("/ava/");

/**
 * Driv Keycloaks login-formulär i browsern; vänta tills appen är inloggad och
 * bunden.
 *
 * Första inloggningen i en ny webbläsare binder identiteten och laddar sedan
 * om sidan SJÄLV (`applyOidcOutcome` i demo-bootstrap) — en knapp halvsekund
 * efter att `/ava/` laddats. Synkpillen finns bara i den bundna appen (inte i
 * bindningsfasen), så när den syns är omladdningen gjord. Utan den väntan
 * krockar specens nästa `page.goto` med omladdningen: appens navigering vinner
 * och `goto` avbryts med net::ERR_ABORTED (#1435).
 */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/ava/");
  await page.waitForURL(AUTHORIZE_RE);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  // Att bara vänta på att Keycloak är lämnat släpper på callbacken, och då
  // krockar specens nästa `page.goto` med omdirigeringen till `/ava/`.
  await page.waitForURL(inApp);
  await page.getByTestId("sync-pill").waitFor({ state: "visible", timeout: 45_000 });
}
