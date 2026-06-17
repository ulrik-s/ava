/**
 * `forwarded-claims` — server-side OIDC-claims ur oauth2-proxy:s forwarded
 * headers (#410, ADR 0016 server-first + ADR 0009 OIDC relying party).
 *
 * I server-first-runtimen verifieras principalen **server-side**: oauth2-proxy
 * (#222) sitter framför nginx-fronten, gör hela OIDC-dansen, och injicerar den
 * inloggade användarens claims som `X-Auth-Request-*`-headers
 * (`OAUTH2_PROXY_SET_XAUTHREQUEST=true`). Detta är server-motsvarigheten till
 * klientens `/oauth2/userinfo`-hämtning (`src/lib/client/backend/oidc-principal.ts`)
 * och ger SAMMA claim-form (email + display-namn; `sub`/`iss` forwardas inte →
 * email-only-modellen, #224/ADR 0009).
 *
 * **Förtroendegräns (KRITISK):** dessa headers får BARA litas på när requesten
 * bevisligen passerat oauth2-proxy. I deployen sätter nginx dem via
 * `auth_request_set` EFTER `auth_request /oauth2/auth` och MÅSTE strippa
 * klient-skickade `X-Auth-Request-*` så en klient inte kan spoofa en identitet.
 * Backenden lyssnar bara på loopback bakom fronten (se `node-http-adapter`).
 */

import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";

/** Header-namnen oauth2-proxy/nginx exponerar (gemener — `Headers.get` är case-insensitivt). */
export interface ForwardedHeaderNames {
  email: string;
  user: string;
  preferredUsername: string;
}

/** Default: oauth2-proxy:s `X-Auth-Request-*` (SET_XAUTHREQUEST). */
export const DEFAULT_FORWARDED_HEADER_NAMES: ForwardedHeaderNames = {
  email: "x-auth-request-email",
  user: "x-auth-request-user",
  preferredUsername: "x-auth-request-preferred-username",
};

/**
 * Läs forwarded OIDC-claims ur request-headers. `null` när email saknas
 * (ej inloggad / ej bakom oauth2-proxy) → principal-resolvern ger då `null`
 * och skyddade procedurer kastar `UNAUTHORIZED`.
 */
export function forwardedClaims(
  headers: Headers,
  names: ForwardedHeaderNames = DEFAULT_FORWARDED_HEADER_NAMES,
): OidcClaims | null {
  const email = headers.get(names.email)?.trim();
  if (!email) return null;
  const preferred = headers.get(names.preferredUsername)?.trim();
  const user = headers.get(names.user)?.trim();
  // sub/iss forwardas inte av oauth2-proxy (email-only, #224/ADR 0009).
  return { email, subject: "", issuer: "", name: preferred || user || "" };
}
