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
 *   - Adressen matchar mer än ett konto → `null` (#1408). Adressen är unik
 *     (index `users_login_email_uq`); en dubblett från före indexet nekas i
 *     stället för att inloggningen tar första träffen — fel konto är värre
 *     än ingen inloggning.
 *   - Bunden identitet (`oidcSubject` satt) måste matcha claims sub+iss → annars
 *     `null` (skydd mot att kapa någon annans email hos en annan IdP). Obunden
 *     rad accepteras via email — det är den BESLUTADE modellen (#224, ADR 0009):
 *     single-IdP → email är auktoritativ, sub/iss-bindning uppskjuten tills
 *     multi-IdP blir aktuellt. Matchningen nedan stödjer redan bindning den dag
 *     allowlist-rader får `oidcSubject` satt.
 */

import { log } from "@/lib/shared/observability/logger";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { sameLoginEmail } from "./login-email-normalize";
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
  /** Bunden OIDC-identitet. Email-only idag (#224/ADR 0009); sätts först när
   *  sub/iss-bindning införs (multi-IdP). Satt → måste matcha claims sub+iss. */
  oidcSubject?: string | null;
  oidcIssuer?: string | null;
  /** false = avprovisionerad. */
  active?: boolean;
}

/** Är en (ev. redan bunden) rad konsistent med dessa claims? Obunden = OK. */
function bindingOk(user: AllowlistedUser, claims: OidcClaims): boolean {
  if (!user.oidcSubject) return true; // obunden → första login binder via email
  return user.oidcSubject === claims.subject && user.oidcIssuer === claims.issuer;
}

function toPrincipal(user: AllowlistedUser, claims: OidcClaims): Principal {
  return {
    id: asId<"UserId">(user.id),
    email: user.email,
    name: user.name || claims.name || user.email,
    role: userRoleSchema.parse(user.role),
    organizationId: asId<"OrganizationId">(user.organizationId),
  };
}

/**
 * Inloggningens utfall för claims med e-post:
 *   - `authorized` — exakt ett aktivt, konsistent konto,
 *   - `ambiguous`  — adressen matchar flera konton → neka (#1408),
 *   - `denied`     — okänd, inaktiverad eller bunden till en annan identitet.
 */
export type LoginResolution =
  | { kind: "authorized"; principal: Principal }
  | { kind: "ambiguous"; userIds: string[] }
  | { kind: "denied" };

/** Slå upp claims i allowlisten. Fail closed: aldrig "första träffen". */
export function resolveLogin(claims: OidcClaims, users: readonly AllowlistedUser[]): LoginResolution {
  const matches = users.filter((u) => sameLoginEmail(u.email, claims.email));
  if (matches.length > 1) return { kind: "ambiguous", userIds: matches.map((u) => u.id) };
  const user = matches[0];
  if (!user || user.active === false || !bindingOk(user, claims)) return { kind: "denied" };
  return { kind: "authorized", principal: toPrincipal(user, claims) };
}

export class OidcAuthProvider implements AuthProvider {
  constructor(
    private readonly claims: OidcClaims | null,
    private readonly users: readonly AllowlistedUser[],
  ) {}

  getPrincipal(): Principal | null {
    if (!this.claims?.email) return null;
    const outcome = resolveLogin(this.claims, this.users);
    // Kontonas id:n, aldrig adressen (dataminimering): admin rättar dubbletten.
    if (outcome.kind === "ambiguous") log.warn("auth.ambiguous_login_email", { count: outcome.userIds.length, ids: outcome.userIds });
    return outcome.kind === "authorized" ? outcome.principal : null;
  }
}
