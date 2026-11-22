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

import { z } from "zod";
import { safeParseJsonWith } from "@/lib/shared/parse-json";
import {
  fortnoxTokenResponseSchema,
  type FortnoxConfig,
  type FortnoxStoredTokens,
  type FortnoxTokenResponse,
} from "./schema";

export type FetchFn = typeof globalThis.fetch;

const AUTH_PATH = "/oauth-v1/auth";
const TOKEN_PATH = "/oauth-v1/token";

/**
 * Fortnox avvisade förnyelsen med `invalid_grant` (OAuth 2.0, RFC 6749 §5.2):
 * refresh-token är använd eller utgången, och anslutningen måste göras om
 * (#1813). Skiljer sig från tillfälliga fel (nät, 5xx), som kastas som vanliga
 * `Error`. Anroparen känner igen den med `instanceof`. Bär inga tokenvärden.
 */
export class FortnoxReconnectRequiredError extends Error {
  constructor() {
    super("Fortnox avvisade förnyelsen (invalid_grant): anslutningen måste göras om.");
    this.name = "FortnoxReconnectRequiredError";
  }
}

/** Felkroppen från token-endpointen (RFC 6749 §5.2); bara felkoden behövs. */
const oauthErrorBodySchema = z.object({ error: z.string() });

/** OAuth-felkoden ur en felkropp, eller null om kroppen inte är ett OAuth-fel. */
function oauthErrorCode(detail: string): string | null {
  const parsed = safeParseJsonWith(oauthErrorBodySchema, detail);
  return parsed.success ? parsed.data.error : null;
}

/** Felet för ett token-svar som inte är 2xx. Bara en avvisad förnyelse blir typad. */
async function tokenError(res: Response, grantType: string | undefined): Promise<Error> {
  const detail = await res.text().catch(() => "");
  const rejectedRefresh = grantType === "refresh_token" && res.status === 400;
  if (rejectedRefresh && oauthErrorCode(detail) === "invalid_grant") return new FortnoxReconnectRequiredError();
  return new Error(`Fortnox token-fel ${res.status}: ${detail.slice(0, 300)}`);
}

/**
 * Bygg authorize-URL:n användaren skickas till. `state` ska vara slumpad (CSRF).
 *
 * `redirect_uri` läggs på RÅ, inte percent-encodad. Fortnox jämför parametern
 * mot registreringen i Developer Portal innan den URL-decodas, så en korrekt
 * encodad `https%3A%2F%2F…` ger `redirect_uri_mismatch` trots att URI:n är
 * registrerad tecken för tecken. Verifierat mot skarp authorize-endpoint
 * 2026-09-05 (#1038): encodad → mismatch, rå → consent-dialog. Fortnox egna
 * exempel visar den också oencodad.
 *
 * Resten går genom URLSearchParams — `scope` MÅSTE encodas (mellanslag).
 */
export function buildAuthorizeUrl(config: FortnoxConfig, state: string): string {
  const url = new URL(AUTH_PATH, config.authBase);
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(" "),
    state,
    access_type: "offline", // krävs för att få en refresh-token
    response_type: "code",
  });
  // account_type är VALFRI hos Fortnox: utelämnad = user-consent (det verifierade
  // flödet). Sätt bara "service" när byrån medvetet kör service-konto (#213).
  if (config.accountType) params.set("account_type", config.accountType);
  url.search = `redirect_uri=${config.redirectUri}&${params.toString()}`;
  return url.toString();
}

function basicAuthHeader(config: FortnoxConfig): string {
  const raw = `${config.clientId}:${config.clientSecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * Gemensam token-POST + strikt parsning. Kastar vid icke-2xx:
 * `FortnoxReconnectRequiredError` när en förnyelse avvisas med `invalid_grant`,
 * annars ett vanligt fel med Fortnox felkod.
 */
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
  if (!res.ok) throw await tokenError(res, body.grant_type);
  return fortnoxTokenResponseSchema.parse(await res.json());
}

/**
 * Räkna ut persisterad token-shape (med ~30 s säkerhetsmarginal på utgång).
 * `renewedAt` = när refresh-token lämnades ut (#1813), för dess 45 dygn.
 */
function toStoredTokens(resp: FortnoxTokenResponse, nowMs: number): FortnoxStoredTokens {
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    accessTokenExpiresAt: nowMs + (resp.expires_in - 30) * 1000,
    renewedAt: nowMs,
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

/**
 * Steg 3: förnya access-token. Returnerar NYA tokens (refresh roterar!).
 * Kastar `FortnoxReconnectRequiredError` när Fortnox avvisar refresh-token.
 */
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
