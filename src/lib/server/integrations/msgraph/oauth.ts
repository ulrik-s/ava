/**
 * Microsoft Entra OAuth2 — Authorization Code-flöde (#1072).
 *
 *   1. `buildAuthorizeUrl` → användaren skickas till Entra, godkänner,
 *      redirectas tillbaka med `?code=…&state=…`.
 *   2. `exchangeCodeForTokens` → byt code mot access+refresh-token.
 *   3. `refreshTokens` → förnya access-token. Entra utfärdar en NY
 *      refresh-token varje gång och den gamla ska kastas → spara alltid den
 *      nya (samma fälla som Fortnox, se #1073).
 *
 * ## `redirect_uri` ska vara PERCENT-ENCODAD här — tvärtom mot Fortnox
 *
 * Fortnox jämför parametern mot registreringen INNAN URL-decode, vilket
 * tvingade fram en rå sträng i `fortnox/oauth.ts`. Microsoft gör tvärtom:
 * "It must exactly match one of the redirect URIs you registered … except it
 * must be URL-encoded" (Microsoft Learn, v2-oauth2-auth-code-flow, hämtad
 * 2026-09-06). Därför bygger vi hela query-strängen med `URLSearchParams` —
 * och regressionstestet asserterar på RÅSTRÄNGEN, för `url.searchParams`
 * decodar åt en och skulle dölja ett fel åt endera hållet.
 *
 * Allt nät via injicerad `fetch` (testbar utan riktig Entra).
 */

import {
  msTokenResponseSchema,
  type MsGraphConfig,
  type MsStoredTokens,
  type MsTokenResponse,
} from "./schema";

export type FetchFn = typeof globalThis.fetch;

function authorizeEndpoint(config: MsGraphConfig): string {
  return `${config.authBase}/${config.tenantId}/oauth2/v2.0/authorize`;
}

function tokenEndpoint(config: MsGraphConfig): string {
  return `${config.authBase}/${config.tenantId}/oauth2/v2.0/token`;
}

/**
 * Bygg authorize-URL:n användaren skickas till. `state` ska vara slumpad (CSRF).
 *
 * `response_mode=query` är explicit: default vore query ändå för enbart `code`,
 * men den dagen någon lägger till `id_token` i `response_type` byter Entra tyst
 * till `fragment` — och en fragment-del når aldrig en lokal callback-server.
 */
export function buildAuthorizeUrl(config: MsGraphConfig, state: string): string {
  const url = new URL(authorizeEndpoint(config));
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: config.scopes.join(" "),
    state,
  }).toString();
  return url.toString();
}

/** Gemensam token-POST + strikt parsning. Kastar vid icke-2xx. */
async function postToken(
  config: MsGraphConfig,
  body: Record<string, string>,
  fetchFn: FetchFn,
): Promise<MsTokenResponse> {
  const res = await fetchFn(tokenEndpoint(config), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes.join(" "),
      ...body,
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // AADSTS-koden i kroppen är det enda som säger VAD som var fel — ta med den.
    throw new Error(`Entra token-fel ${res.status}: ${detail.slice(0, 300)}`);
  }
  return msTokenResponseSchema.parse(await res.json());
}

/**
 * Persisterad token-shape (~30 s säkerhetsmarginal på utgången).
 *
 * Saknas `refresh_token` begärdes inte `offline_access` — säg det rakt ut i
 * stället för att låta anropet lyckas och kedjan dö vid nästa körning.
 */
function toStoredTokens(resp: MsTokenResponse, nowMs: number): MsStoredTokens {
  if (!resp.refresh_token) {
    throw new Error("Entra returnerade ingen refresh_token — saknas scopet offline_access?");
  }
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    accessTokenExpiresAt: nowMs + (resp.expires_in - 30) * 1000,
  };
}

/** Steg 2: byt authorization-code mot tokens. */
export async function exchangeCodeForTokens(
  config: MsGraphConfig,
  code: string,
  fetchFn: FetchFn = globalThis.fetch,
  nowMs: number = Date.now(),
): Promise<MsStoredTokens> {
  const resp = await postToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  }, fetchFn);
  return toStoredTokens(resp, nowMs);
}

/** Steg 3: förnya access-token. Returnerar NYA tokens (refresh roterar!). */
export async function refreshTokens(
  config: MsGraphConfig,
  refreshToken: string,
  fetchFn: FetchFn = globalThis.fetch,
  nowMs: number = Date.now(),
): Promise<MsStoredTokens> {
  const resp = await postToken(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }, fetchFn);
  return toStoredTokens(resp, nowMs);
}
