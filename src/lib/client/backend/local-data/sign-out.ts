/**
 * Logga ut (#1347): rensa den lokala datan, glöm identiteten och avsluta
 * sessionen hos oauth2-proxy (och, om driften konfigurerat det, hos IdP:n).
 *
 *   1. Användarens lokala data rensas (`purgeLocalData`): kopiorna av serverns
 *      data tas bort, bara hennes osynkade arbete ligger kvar i hennes egna
 *      databaser till nästa inloggning som samma användare.
 *   2. Identiteten i `ava.firma` glöms, liksom sessionsbundna nycklar och hela
 *      `sessionStorage` (t.ex. Microsoft-inloggningens tokens).
 *   3. Andra flikar får veta det och laddar om (de hamnar i inloggningen).
 *   4. `/oauth2/sign_out` tar bort proxyns HttpOnly-cookie — den går inte att
 *      ta bort från JavaScript. `rd` pekar på IdP:ns utloggning (RP-initierad
 *      utloggning, `end_session_endpoint`) om driften satt
 *      `AVA_OIDC_END_SESSION_URL`, annars på sidan "Du är utloggad".
 *      oauth2-proxy följer bara `rd` till domäner i `--whitelist-domain`.
 *
 * Utloggning offline: allt lokalt görs ändå och sidan går till appens rot
 * (som utan bunden identitet ber om uppkoppling). `PENDING_SIGN_OUT_KEY` gör
 * att nästa start online går via `/oauth2/sign_out` först — annars skulle
 * cookien släppa in nästa person som den utloggade.
 */

import { forgetSignedInIdentity, type FirmaTier } from "@/lib/client/firma/firma-config";
import { reportIdbProblem } from "@/lib/server/data-store/in-memory/idb-open";
import { activeLocalScope, unbindLocalNamespace, userNamespace } from "./local-namespace";
import { purgeLocalData, type PurgeEnv } from "./purge-local-data";

/** localStorage-nyckeln som säger att proxyns session ännu inte avslutats. */
export const PENDING_SIGN_OUT_KEY = "ava.pendingSignOut";

/** Nycklar i `localStorage` som hör till sessionen, inte till webbläsaren. */
export const SESSION_LOCAL_STORAGE_KEYS: readonly string[] = ["ava.calendar.selectedUsers", "ava.outlookToken"];

/** Sidan man landar på efter utloggningen. */
export function signedOutLandingPath(basePath: string): string {
  return `${basePath}/login/?signedOut=1`;
}

/** oauth2-proxys utloggning, vidare till IdP:ns utloggning eller landningssidan. */
export function proxySignOutUrl(basePath: string, endSessionUrl: string | null): string {
  return `/oauth2/sign_out?rd=${encodeURIComponent(endSessionUrl ?? signedOutLandingPath(basePath))}`;
}

/** Det utloggningen behöver ur webbläsaren (injicerbart i tester). */
export interface SignOutEnv extends PurgeEnv {
  session: Pick<Storage, "clear">;
  tier: FirmaTier;
  basePath: string;
  navigate: (url: string) => void;
  /** Når webbläsaren nätet (`navigator.onLine`)? */
  online: () => boolean;
  notifyOtherTabs: () => void;
  /** IdP:ns utloggnings-URL (`system.signOutConfig`), eller null. */
  endSessionUrl: () => Promise<string | null>;
}

/** Rensa det som hör till den inloggade i den här webbläsaren. */
async function forgetLocally(env: SignOutEnv): Promise<void> {
  const scope = activeLocalScope();
  // Ett lagringsfel får inte hindra utloggningen (raderingar som inte gick görs om vid nästa start).
  if (scope) {
    await purgeLocalData(env, { factory: env.factory, ns: userNamespace(scope), adoptsLegacy: false })
      .catch((e: unknown) => reportIdbProblem(new Error("Lokal data kunde inte rensas helt vid utloggningen", { cause: e })));
  }
  forgetSignedInIdentity();
  for (const key of SESSION_LOCAL_STORAGE_KEYS) env.storage.removeItem(key);
  env.session.clear();
  unbindLocalNamespace();
}

/** Var utloggningen slutar: demon → kontoväljaren; self-hosted → proxyns utloggning (offline: roten). */
async function signOutDestination(env: SignOutEnv): Promise<string> {
  if (env.tier === "demo") return `${env.basePath}/login/`;
  env.storage.setItem(PENDING_SIGN_OUT_KEY, "1");
  if (!env.online()) return `${env.basePath}/`;
  return proxySignOutUrl(env.basePath, await env.endSessionUrl().catch(() => null));
}

/** Logga ut (efter att användaren tagit ställning till osynkade ändringar). */
export async function signOut(env: SignOutEnv): Promise<void> {
  await forgetLocally(env);
  env.notifyOtherTabs();
  env.navigate(await signOutDestination(env));
}

/**
 * Vid start (self-hosted, online): avslutades inte proxyns session förra
 * gången (utloggning offline)? Då går vi via `/oauth2/sign_out` först.
 * Nyckeln tas bort direkt, så att en felkonfigurerad IdP-återkomst aldrig blir
 * en loop. Offline ligger den kvar till nästa start.
 */
export function pendingSignOutRedirect(
  storage: Pick<Storage, "getItem" | "removeItem">, basePath: string, online: boolean,
): string | null {
  if (!online || storage.getItem(PENDING_SIGN_OUT_KEY) === null) return null;
  storage.removeItem(PENDING_SIGN_OUT_KEY);
  return proxySignOutUrl(basePath, null);
}

/** Landningssidan nåddes: proxyns session är avslutad. */
export function completeSignOut(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(PENDING_SIGN_OUT_KEY);
}
