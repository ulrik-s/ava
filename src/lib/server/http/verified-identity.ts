/**
 * Verifierad identitet (#1256) — servern litar inte på proxyns headers.
 *
 * I standardläget (`forwarded`) läser servern användaren ur oauth2-proxys
 * `X-Auth-Request-Email`. Det är säkert bara så länge server-first aldrig kan
 * nås förbi proxyn: den som når porten direkt kan skicka vilken e-post som
 * helst.
 *
 * I läget `verified` (`AVA_IDENTITY=verified`) ignoreras de headers helt.
 * Identiteten kommer i stället ur en SIGNERAD token som servern själv
 * verifierar mot IdP:ns nycklar (JWKS): proxyns ID-token (oauth2-proxy
 * `--set-authorization-header`, som Caddy kopierar till
 * `X-Ava-Identity-Token`), eller en klients egen Bearer (helpern, add-in:en).
 * En förfalskad header ger ingenting — signaturen stämmer inte.
 */

import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet } from "jose";
import { remoteJwksForIssuer, type BearerVerifyConfig } from "./bearer-claims";

/** Headern proxyn lägger ID-token i (`Bearer <jwt>`). */
export const IDENTITY_TOKEN_HEADER = "x-ava-identity-token";

export type IdentityConfig =
  | { mode: "forwarded" }
  | { mode: "verified"; verify: BearerVerifyConfig };

type Env = Record<string, string | undefined>;
type Fetch = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function envValue(env: Env, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

/** `a,b` → `["a","b"]`; en enda → strängen. */
export function parseAudience(raw: string | undefined): string | string[] | undefined {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

/**
 * JWKS ur IdP:ns OIDC-discovery (`.well-known/openid-configuration` →
 * `jwks_uri`), hämtad vid första verifieringen. Entra, Google och Keycloak
 * publicerar alla discovery — ingen IdP-specifik sökväg i koden.
 */
export function discoveredJwks(
  issuer: string,
  fetchFn: Fetch = (u) => fetch(u),
  remote: (uri: string) => JWTVerifyGetKey = (uri) => createRemoteJWKSet(new URL(uri)),
): JWTVerifyGetKey {
  let keys: Promise<JWTVerifyGetKey> | null = null;
  const load = async (): Promise<JWTVerifyGetKey> => {
    const res = await fetchFn(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    const doc = res.ok ? await res.json() : null;
    const uri = typeof doc === "object" && doc !== null ? (doc as { jwks_uri?: unknown }).jwks_uri : undefined;
    if (typeof uri !== "string") throw new Error(`OIDC-discovery för ${issuer} saknar jwks_uri.`);
    return remote(uri);
  };
  return async (header, token) => {
    keys ??= load().catch((err: unknown) => { keys = null; throw err; });
    return (await keys)(header, token);
  };
}

/**
 * Identitetsläget ur miljön. `verified` kräver issuer och audience — utan
 * dem vore verifieringen meningslös (vilken IdP:s token som helst, eller en
 * token utfärdad till en annan klient, skulle godtas). Felkonfiguration
 * stoppar starten: hellre ingen server än en som tror att den verifierar.
 *
 *   - `AVA_IDENTITY`           `forwarded` (default) | `verified`
 *   - `AVA_IDENTITY_ISSUER`    IdP:ns issuer (samma som oauth2-proxys)
 *   - `AVA_IDENTITY_AUDIENCE`  oauth2-proxys klient-id (kommaseparerat för flera)
 *   - `AVA_IDENTITY_JWKS_URI`  valfri; annars OIDC-discovery
 */
export function identityConfigFromEnv(env: Env = process.env): IdentityConfig {
  const mode = envValue(env, "AVA_IDENTITY") ?? "forwarded";
  if (mode === "forwarded") return { mode };
  if (mode !== "verified") throw new Error(`AVA_IDENTITY måste vara "forwarded" eller "verified", inte "${mode}".`);
  const issuer = envValue(env, "AVA_IDENTITY_ISSUER");
  const audience = parseAudience(envValue(env, "AVA_IDENTITY_AUDIENCE"));
  if (!issuer || !audience) throw new Error("AVA_IDENTITY=verified kräver AVA_IDENTITY_ISSUER och AVA_IDENTITY_AUDIENCE.");
  const jwksUri = envValue(env, "AVA_IDENTITY_JWKS_URI");
  return { mode, verify: { issuer, audience, jwks: jwksUri ? remoteJwksForIssuer(issuer, jwksUri) : discoveredJwks(issuer) } };
}
