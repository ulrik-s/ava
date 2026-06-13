/**
 * Fortnox OAuth2 — Authorization Code-flöde (#82).
 *
 *   1. `buildAuthorizeUrl` → användaren skickas till Fortnox, godkänner,
 *      redirectas tillbaka med `?code=…&state=…`.
 *   2. `exchangeCodeForTokens` → byt code mot access+refresh-token.
 *   3. `refreshTokens` → förnya access-token. OBS: refresh-token ROTERAR
 *      (gammal blir ogiltig) → spara alltid den nya.
 *
 * Token-endpoint kräver HTTP Basic auth (base64(client_id:client_secret))
 * och `application/x-www-form-urlencoded`. Allt nät via injicerad `fetch`
 * (testbar utan riktig Fortnox).
 */

import {
  fortnoxTokenResponseSchema,
  type FortnoxConfig,
  type FortnoxStoredTokens,
  type FortnoxTokenResponse,
} from "./schema";

export type FetchFn = typeof globalThis.fetch;

const AUTH_PATH = "/oauth-v1/auth";
const TOKEN_PATH = "/oauth-v1/token";

/** Bygg authorize-URL:n användaren skickas till. `state` ska vara slumpad (CSRF). */
export function buildAuthorizeUrl(config: FortnoxConfig, state: string): string {
  const url = new URL(AUTH_PATH, config.authBase);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
    access_type: "offline", // krävs för att få en refresh-token
    response_type: "code",
  });
  // account_type är VALFRI hos Fortnox: utelämnad = user-consent (det verifierade
  // flödet). Sätt bara "service" när byrån medvetet kör service-konto (#213).
  if (config.accountType) params.set("account_type", config.accountType);
  url.search = params.toString();
  return url.toString();
}

function basicAuthHeader(config: FortnoxConfig): string {
  const raw = `${config.clientId}:${config.clientSecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/** Gemensam token-POST + strikt parsning. Kastar vid icke-2xx. */
async function postToken(
  config: FortnoxConfig,
  body: Record<string, string>,
  fetchFn: FetchFn,
): Promise<FortnoxTokenResponse> {
  const res = await fetchFn(new URL(TOKEN_PATH, config.authBase).toString(), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Fortnox token-fel ${res.status}: ${detail.slice(0, 300)}`);
  }
  return fortnoxTokenResponseSchema.parse(await res.json());
}

/** Räkna ut persisterad token-shape (med ~30 s säkerhetsmarginal på utgång). */
function toStoredTokens(resp: FortnoxTokenResponse, nowMs: number): FortnoxStoredTokens {
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    accessTokenExpiresAt: nowMs + (resp.expires_in - 30) * 1000,
  };
}

/** Steg 2: byt authorization-code mot tokens. */
export async function exchangeCodeForTokens(
  config: FortnoxConfig,
  code: string,
  fetchFn: FetchFn = globalThis.fetch,
  nowMs: number = Date.now(),
): Promise<FortnoxStoredTokens> {
  const resp = await postToken(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  }, fetchFn);
  return toStoredTokens(resp, nowMs);
}

/** Steg 3: förnya access-token. Returnerar NYA tokens (refresh roterar!). */
export async function refreshTokens(
  config: FortnoxConfig,
  refreshToken: string,
  fetchFn: FetchFn = globalThis.fetch,
  nowMs: number = Date.now(),
): Promise<FortnoxStoredTokens> {
  const resp = await postToken(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }, fetchFn);
  return toStoredTokens(resp, nowMs);
}
