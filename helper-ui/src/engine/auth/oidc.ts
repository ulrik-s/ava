/**
 * OIDC-klient-primitiver för helperns loopback-PKCE-auth (ADR 0028 §2, RFC 8252).
 *
 * IdP-agnostiskt (BYO-IdP): endpoints hämtas via OIDC-discovery
 * (`.well-known/openid-configuration`), så samma kod funkar mot Keycloak-
 * fixturen (dev) och Entra/Google/Okta (produktion). Rena request-byggare +
 * svars-parsning → testbara med mockad fetch + injicerad klocka.
 */

export interface OidcEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

/** Token-set efter code-exchange/refresh. `expiresAt` = absolut ms (now+expires_in). */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** ms sedan epoch då access-token går ut. */
  expiresAt: number;
}

/** Minimal fetch-form (global `fetch` + test-mocks är assignerbara) — undviker
 *  cast mot den överlagrade `typeof fetch` i tester. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type FetchFn = FetchLike;

/** Hämta endpoints ur IdP:ns discovery-dokument. */
export async function discoverOidc(issuer: string, fetchFn: FetchFn = fetch): Promise<OidcEndpoints> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const resp = await fetchFn(url);
  if (!resp.ok) throw new Error(`OIDC discovery HTTP ${resp.status}`);
  const d = (await resp.json()) as Record<string, unknown>;
  const authorizationEndpoint = d.authorization_endpoint;
  const tokenEndpoint = d.token_endpoint;
  if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string") {
    throw new Error("OIDC discovery saknar authorization_endpoint/token_endpoint");
  }
  return { issuer: typeof d.issuer === "string" ? d.issuer : issuer, authorizationEndpoint, tokenEndpoint };
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope?: string;
}

/** Bygg authorize-URL:en (det browsern öppnas mot). */
export function buildAuthorizeUrl(ep: OidcEndpoints, p: AuthorizeParams): string {
  const url = new URL(ep.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("scope", p.scope ?? "openid email profile offline_access");
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", p.state);
  return url.toString();
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
}

/** Tolka ett token-endpoint-svar → TokenSet (kastar vid saknat access_token). */
function parseTokenResponse(body: TokenResponse, now: number): TokenSet {
  if (typeof body.access_token !== "string") throw new Error("token-svar saknar access_token");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 300;
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === "string" ? { refreshToken: body.refresh_token } : {}),
    ...(typeof body.id_token === "string" ? { idToken: body.id_token } : {}),
    expiresAt: now + expiresIn * 1000,
  };
}

async function postToken(ep: OidcEndpoints, form: URLSearchParams, fetchFn: FetchFn, now: () => number): Promise<TokenSet> {
  const resp = await fetchFn(ep.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!resp.ok) throw new Error(`token HTTP ${resp.status}`);
  return parseTokenResponse((await resp.json()) as TokenResponse, now());
}

export interface ExchangeParams {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}

/** Byt auktoriserings-kod + PKCE-verifier mot tokens. */
export function exchangeCode(ep: OidcEndpoints, p: ExchangeParams, fetchFn: FetchFn = fetch, now: () => number = Date.now): Promise<TokenSet> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
  });
  return postToken(ep, form, fetchFn, now);
}

/** Förnya tokens med en refresh-token. */
export function refreshTokens(ep: OidcEndpoints, p: { clientId: string; refreshToken: string }, fetchFn: FetchFn = fetch, now: () => number = Date.now): Promise<TokenSet> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: p.clientId,
    refresh_token: p.refreshToken,
  });
  return postToken(ep, form, fetchFn, now);
}
