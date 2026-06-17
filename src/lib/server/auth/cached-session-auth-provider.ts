/**
 * `CachedSessionAuthProvider` (#415 / D2, ADR 0018 Option A — fallback) —
 * den principal offline-klienten arbetar under när den inte når IdP:n.
 *
 * ADR 0018: efter login cachas den verifierade OIDC-identiteten; klienten får
 * arbeta offline under en konfigurerbar **grace** (default ~7 dagar). När
 * grace:n löpt ut returneras `null` (→ skyddade procedurer kastar UNAUTHORIZED;
 * klienten måste återansluta och re-validera). Servern omvaliderar ändå
 * principalen vid sync (reconcile) — detta är bara den lokala offline-grinden.
 *
 * Den primära mekanismen (Option B, `offline_access`-refresh-token) lever i
 * auth-/token-lagret; denna provider täcker fallback-vägen + är den enkla
 * abstraktion `buildContext({ principal })` matas med offline.
 */

import type { AuthProvider, Principal } from "./principal";

/** ~7 dagar — ADR 0018 default-grace. */
export const DEFAULT_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedSession {
  /** Den vid login verifierade principalen. */
  principal: Principal;
  /** Epoch-ms när sessionen cachades (vid senaste lyckade online-login). */
  cachedAt: number;
  /** Grace-fönstrets längd i ms. Default {@link DEFAULT_OFFLINE_GRACE_MS}. */
  graceMs?: number;
}

export class CachedSessionAuthProvider implements AuthProvider {
  constructor(
    private readonly session: CachedSession | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getPrincipal(): Principal | null {
    if (!this.session) return null;
    const graceMs = this.session.graceMs ?? DEFAULT_OFFLINE_GRACE_MS;
    if (this.now() - this.session.cachedAt > graceMs) return null; // grace utgången
    return this.session.principal;
  }
}
