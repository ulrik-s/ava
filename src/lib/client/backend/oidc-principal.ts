/**
 * Self-hosted OIDC-login: brygga från oauth2-proxy → AVA-principal (#222, ADR 0009).
 *
 * oauth2-proxy (#222-infra) sköter hela OIDC-dansen och exponerar den
 * inloggade användarens claims på `/oauth2/userinfo` (samma origin → cookien
 * följer med automatiskt); frågan ställs i `auth/session-probe.ts`. Här
 * auktoriseras claims mot användar-allowlisten via `OidcAuthProvider` (#223).
 *
 * `sub`/`iss`-bindning utelämnas här (oauth2-proxy:s userinfo ger inte dem) →
 * matchning sker på email. Det är den BESLUTADE modellen (#224, ADR 0009):
 * single-IdP → email-only; sub/iss-bindning uppskjuten tills multi-IdP blir
 * aktuellt (kräver då att oauth2-proxy exponerar sub/iss).
 */

import {
  OidcAuthProvider,
  resolveLogin,
  type AllowlistedUser,
  type OidcClaims,
} from "@/lib/server/auth/oidc-auth-provider";
import type { Principal } from "@/lib/server/auth/principal";

// Re-export så klient-konsumenter (t.ex. demo-bootstrap) kan typa claims utan
// att importera server-modulen direkt över boundary.
export type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";

/** Lös self-hosted-principalen ur OIDC-claims + firma.git-allowlisten (#223). */
export function resolveSelfHostedPrincipal(
  claims: OidcClaims | null,
  users: readonly AllowlistedUser[],
): Principal | null {
  return new OidcAuthProvider(claims, users).getPrincipal();
}

/**
 * Klassificera self-hosted-login utifrån claims + allowlist (#222-wiring):
 *   - `no-session`  — ingen OIDC-session (ej bakom oauth2-proxy / ej inloggad);
 *     callern faller tillbaka på sitt vanliga (icke-OIDC) beteende.
 *   - `denied`      — autentiserad IdP-identitet men INTE i byråns allowlist →
 *     neka (autentisering ≠ auktorisering, #223).
 *   - `ambiguous`   — adressen hör till flera konton → neka (#1408) i stället
 *     för att välja det första.
 *   - `authorized`  — allowlistad → principal ur firma.git.
 */
export type OidcLoginOutcome =
  | { kind: "authorized"; principal: Principal }
  | { kind: "denied"; email: string }
  | { kind: "ambiguous"; email: string }
  | { kind: "no-session" };

export function classifyOidcLogin(
  claims: OidcClaims | null,
  users: readonly AllowlistedUser[],
): OidcLoginOutcome {
  if (!claims) return { kind: "no-session" };
  const outcome = resolveLogin(claims, users);
  return outcome.kind === "authorized" ? outcome : { kind: outcome.kind, email: claims.email };
}
