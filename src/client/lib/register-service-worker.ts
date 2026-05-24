/**
 * `registerServiceWorker` — säker SW-registreringshjälp.
 *
 * Designval:
 *   - Single responsibility: registrerar bara en SW. Inga side-effects
 *     mot UI eller routing.
 *   - Idempotent: kallas vid varje page-load, browser:s dedup-logik
 *     hanterar att samma SW inte registreras dubbelt.
 *   - Felsäker: SSR / unsupported browsers / HTTPS-fel sväljs tyst.
 */

export type RegisterStatus = "unsupported" | "registered" | "failed";

export interface RegisterResult {
  status: RegisterStatus;
  scope?: string;
  error?: Error;
}

export async function registerServiceWorker(swUrl: string): Promise<RegisterResult> {
  // SSR / non-browser
  if (typeof window === "undefined") return { status: "unsupported" };

  const nav = (globalThis as { navigator?: { serviceWorker?: { register: (url: string, opts?: { scope: string }) => Promise<{ scope?: string }> } } }).navigator;
  if (!nav?.serviceWorker) return { status: "unsupported" };

  try {
    const reg = await nav.serviceWorker.register(swUrl, { scope: "/" });
    return { status: "registered", scope: reg.scope };
  } catch (err) {
    console.warn("[sw] registrering misslyckades:", err);
    return {
      status: "failed",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
