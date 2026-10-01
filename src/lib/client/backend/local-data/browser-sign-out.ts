"use client";

/**
 * Utloggningen i webbläsaren (#1347): `signOut` med webbläsarens lagring,
 * navigering och serverns utloggnings-config.
 */

import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { loadServerEndSessionUrl } from "../server-trpc-client";
import { sessionChannel } from "./session-channel";
import { signOut, type SignOutEnv } from "./sign-out";

/** Hur länge utloggningen väntar på serverns config innan den går vidare utan. */
export const END_SESSION_LOOKUP_TIMEOUT_MS = 3_000;

/** `p`, eller null om det tar längre än `ms`. */
export function withinOrNull<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}

/** Webbläsarens miljö för utloggningen. */
export function browserSignOutEnv(): SignOutEnv {
  return {
    factory: globalThis.indexedDB,
    storage: window.localStorage,
    session: window.sessionStorage,
    tier: loadFirmaConfig().tier,
    basePath: process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "",
    navigate: (url) => { window.location.assign(url); },
    online: () => navigator.onLine,
    notifyOtherTabs: () => { sessionChannel().post(); },
    endSessionUrl: () => withinOrNull(loadServerEndSessionUrl(), END_SESSION_LOOKUP_TIMEOUT_MS),
  };
}

/** Logga ut i den här webbläsaren. */
export function signOutInBrowser(): Promise<void> {
  return signOut(browserSignOutEnv());
}
