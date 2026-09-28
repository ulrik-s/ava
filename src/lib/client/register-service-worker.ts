/**
 * `registerServiceWorker` — säker SW-registreringshjälp.
 *
 * Designval:
 *   - Single responsibility: registrerar bara en SW. Inga side-effects
 *     mot UI eller routing.
 *   - Idempotent: kallas vid varje page-load, browser:s dedup-logik
 *     hanterar att samma SW inte registreras dubbelt.
 *   - Felsäker: SSR / unsupported browsers / HTTPS-fel sväljs tyst.
 *   - Scope följer basen (#1240): `/ava/` på GH Pages, `/` i prod.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";

export type RegisterStatus = "unsupported" | "registered" | "failed";

export interface RegisterResult {
  status: RegisterStatus;
  scope?: string;
  /** Registreringen (bara vid `registered`) — för att bevaka uppdateringar. */
  registration?: ServiceWorkerRegistration;
  error?: Error;
}

/** `navigator` där service worker-stödet kan saknas (DOM-typen säger alltid-definierat). */
interface MaybeServiceWorkerNavigator {
  serviceWorker?: Pick<ServiceWorkerContainer, "register">;
}

export async function registerServiceWorker(swUrl: string, scope = "/"): Promise<RegisterResult> {
  // SSR / non-browser
  if (typeof window === "undefined" || typeof navigator === "undefined") return { status: "unsupported" };

  const nav: MaybeServiceWorkerNavigator = navigator;
  if (!nav.serviceWorker) return { status: "unsupported" };

  try {
    const registration = await nav.serviceWorker.register(swUrl, { scope });
    return { status: "registered", registration, ...omitUndefined({ scope: registration.scope }) };
  } catch (err) {
    console.warn("[sw] registrering misslyckades:", err);
    return {
      status: "failed",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
