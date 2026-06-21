/**
 * Bearer-JWT-väg (ADR 0028 §1/§2, ADR 0009) — verifiera en access-token från
 * byråns OIDC-IdP mot dess JWKS och härled SAMMA `OidcClaims` som
 * oauth2-proxy-cookie-vägen (`forwarded-claims`). Används av klienter som inte
 * bär OIDC-cookien: den autonoma helpern (ADR 0028) och Office-add-insen
 * (ADR 0013) — samma tunn-klient-behov, samma server-väg.
 *
 * **IdP-agnostiskt (BYO-IdP):** issuer + JWKS-URL kommer ur konfiguration/OIDC-
 * discovery (Keycloak-fixturen i dev; Entra/Google/Okta i produktion). AVA kör
 * aldrig egen IdP. `jose.jwtVerify` validerar signatur + issuer + (ev.) audience
 * + exp/nbf kryptografiskt — en token utan giltig signatur ger `null` (anonym),
 * precis som en saknad cookie. Inget Keycloak-beroende i koden.
 *
 * `jwks` injiceras (`JWTVerifyGetKey`) → testas med en lokalt signerad token.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";
import type { HelperConfigRequest } from "@/lib/shared/helper/protocol";
import { parseBearerToken } from "./pat";

export interface BearerVerifyConfig {
  /** Förväntad issuer (`iss`) — IdP:ns issuer-URL. */
  issuer: string;
  /** Förväntad audience (`aud`). Utelämnad → ingen aud-kontroll. */
  audience?: string;
  /** Nyckelkälla (JWKS). Injicerbar för test (`createLocalJWKSet`). */
  jwks: JWTVerifyGetKey;
}

/**
 * Verifiera `Authorization: Bearer <jwt>` → `OidcClaims`, eller `null` om
 * headern saknas eller token:en inte validerar (signatur/issuer/audience/exp).
 * Email-only-modellen (#224/ADR 0009): saknas `email`-claim → `null`.
 */
export async function bearerClaims(headers: Headers, config: BearerVerifyConfig): Promise<OidcClaims | null> {
  const token = parseBearerToken(headers.get("authorization"));
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.jwks, {
      issuer: config.issuer,
      ...(config.audience !== undefined ? { audience: config.audience } : {}),
    });
    return claimsFromPayload(payload);
  } catch {
    return null; // ogiltig signatur/issuer/audience/utgången → anonym (UNAUTHORIZED)
  }
}

/** Plocka OidcClaims ur en verifierad JWT-payload; null om email-claim saknas. */
function claimsFromPayload(payload: JWTPayload): OidcClaims | null {
  const email = typeof payload.email === "string" ? payload.email : undefined;
  if (!email) return null; // email-only-modellen (#224/ADR 0009)
  return {
    email,
    subject: typeof payload.sub === "string" ? payload.sub : "",
    issuer: typeof payload.iss === "string" ? payload.iss : "",
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
  };
}

/**
 * JWKS-källa för en OIDC-issuer. Standardväg = Keycloak/OIDC
 * `<issuer>/protocol/openid-connect/certs`; override:as med explicit `jwksUri`
 * (BYO-IdP: hämtas ur IdP:ns `.well-known/openid-configuration`).
 */
export function remoteJwksForIssuer(issuer: string, jwksUri?: string): JWTVerifyGetKey {
  const uri = jwksUri ?? `${issuer.replace(/\/$/, "")}/protocol/openid-connect/certs`;
  return createRemoteJWKSet(new URL(uri));
}

/**
 * Bygg `BearerVerifyConfig` ur miljön, eller `null` om Bearer-vägen inte är
 * konfigurerad (då är beteendet oförändrat — bara oauth2-proxy-cookien gäller).
 *   - `AVA_OIDC_ISSUER`   (krävs) — IdP:ns issuer-URL.
 *   - `AVA_OIDC_JWKS_URI` (valfri) — explicit JWKS-URL (annars Keycloak-vägen).
 *   - `AVA_OIDC_AUDIENCE` (valfri) — förväntad `aud`.
 */
/**
 * Den OIDC-config web-appen ska auto-pusha till helpern (ADR 0029) — den
 * PUBLIKA issuern (som helpern på host:en + browsern når) + klient-id, eller
 * `null` om servern inte har någon helper-/Bearer-auth konfigurerad (demon).
 * Ingen JWKS-URI: helpern gör sin egen discovery ur issuern (serverns interna
 * backchannel-JWKS angår inte helpern).
 */
export function helperOidcConfig(env: Record<string, string | undefined> = process.env): HelperConfigRequest | null {
  const issuer = env.AVA_OIDC_ISSUER?.trim();
  if (!issuer) return null;
  const audience = env.AVA_OIDC_AUDIENCE?.trim();
  return {
    oidcIssuer: issuer,
    oidcClientId: env.AVA_OIDC_CLIENT_ID?.trim() || "ava-helper",
    ...(audience ? { oidcAudience: audience } : {}),
  };
}

export function bearerConfigFromEnv(env: Record<string, string | undefined> = process.env): BearerVerifyConfig | null {
  const issuer = env.AVA_OIDC_ISSUER?.trim();
  if (!issuer) return null;
  const jwksUri = env.AVA_OIDC_JWKS_URI?.trim();
  const audience = env.AVA_OIDC_AUDIENCE?.trim();
  return {
    issuer,
    ...(audience ? { audience } : {}),
    jwks: remoteJwksForIssuer(issuer, jwksUri || undefined),
  };
}
