/**
 * `OidcAuthProvider` — `AuthProvider` som mappar OIDC-claims → `Principal`
 * mot användar-allowlisten i firma.git (#223, ADR 0009).
 *
 * AVA är en OIDC *relying party*: en extern IdP (Entra ID/Google/BankID-broker)
 * autentiserar användaren; `oauth2-proxy` (#222) injicerar claims (email/sub/iss).
 * Denna provider *auktoriserar* genom att slå upp claims mot allowlisten —
 * **de existerande User-raderna** (`.ava/users/<email>.json`), inte en parallell
 * lista (DRY). En användare är allowlistad om en User-rad finns med en roll.
 *
 * Regler:
 *   - Inga/ofullständiga claims → `null` (anonym).
 *   - Email saknas i allowlisten → `null` (neka okänd; autentisering ≠ auktorisering).
 *   - Inaktiverad användare → `null` (avprovisionerad).
 *   - Bunden identitet (`oidcSubject` satt) måste matcha claims sub+iss → annars
 *     `null` (skydd mot att kapa någon annans email hos en annan IdP). Obunden
 *     rad accepteras via email (första login; bindningen skrivs separat, #224).
 */

import type { AuthProvider, Principal } from "./principal";

/** Claims oauth2-proxy/IdP:n levererar (#222 fyller dessa ur headers/userinfo). */
export interface OidcClaims {
  /** "email"-claim. */
  email: string;
  /** "sub" — stabil, IdP-unik användaridentifierare. */
  subject: string;
  /** "iss" — utfärdande IdP. */
  issuer: string;
  /** "name"-claim (valfritt, fallback för display-namn). */
  name?: string;
}

/** Minsta allowlist-rad resolvern behöver — en delmängd av `User`. */
export interface AllowlistedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  /** Bunden OIDC-identitet (sätts vid första login, #224). */
  oidcSubject?: string | null;
  oidcIssuer?: string | null;
  /** false = avprovisionerad. */
  active?: boolean;
}

function emailEq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Är en (ev. redan bunden) rad konsistent med dessa claims? Obunden = OK. */
function bindingOk(user: AllowlistedUser, claims: OidcClaims): boolean {
  if (!user.oidcSubject) return true; // obunden → första login binder via email
  return user.oidcSubject === claims.subject && user.oidcIssuer === claims.issuer;
}

function toPrincipal(user: AllowlistedUser, claims: OidcClaims): Principal {
  return {
    id: user.id,
    email: user.email,
    name: user.name || claims.name || user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
}

export class OidcAuthProvider implements AuthProvider {
  constructor(
    private readonly claims: OidcClaims | null,
    private readonly users: readonly AllowlistedUser[],
  ) {}

  getPrincipal(): Principal | null {
    const claims = this.claims;
    if (!claims?.email) return null;
    const user = this.users.find((u) => emailEq(u.email, claims.email));
    if (!user || user.active === false || !bindingOk(user, claims)) return null;
    return toPrincipal(user, claims);
  }
}
