/**
 * OAuth-fasad framför byråns IdP för remote-MCP (#1026).
 *
 * Entra går inte att peka ut direkt som MCP-klientens auktoriseringsserver:
 *
 * 1. Entras metadata saknar `code_challenge_methods_supported`. MCP-spec:en
 *    säger att klienten då MÅSTE vägra (den kan inte se att PKCE stöds).
 *    Claude stannar med "Anslutningsproblem" innan användaren ens når
 *    Microsofts inloggning.
 * 2. Klienten skickar `resource` (RFC 8707). Entras v2-endpoint vägrar den
 *    när den inte matchar scopets API (AADSTS9010010).
 *
 * Därför publicerar AVA egen RFC 8414-metadata (issuer = AVA:s origin) med
 * PKCE utskrivet, och två tunna vidarebefordringar: `/mcp/authorize`
 * (302 till IdP:n) och `/mcp/token` (POST till IdP:n), båda utan `resource`.
 * Token:en utfärdas fortfarande av IdP:n och verifieras som förut
 * (bearer-claims); AVA lagrar inget, loggar inga kroppar och kan bara
 * skicka vidare till IdP:ns egna endpoints (ingen öppen proxy).
 */

export const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";

/** IdP:ns endpoints ur dess OIDC-discovery. */
export interface UpstreamEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Största token-request som vidarebefordras (en riktig är under 4 kB). */
const MAX_TOKEN_BODY = 64 * 1024;

/**
 * IdP:ns endpoints, hämtade vid första behovet och cachade. Misslyckas
 * hämtningen försöker nästa anrop igen.
 */
export function upstreamFromIssuer(issuer: string, fetchFn: Fetch = (u, i) => fetch(u, i)): () => Promise<UpstreamEndpoints> {
  let cached: Promise<UpstreamEndpoints> | null = null;
  const load = async (): Promise<UpstreamEndpoints> => {
    const res = await fetchFn(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    const doc: unknown = res.ok ? await res.json() : null;
    const d = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : {};
    const { authorization_endpoint: a, token_endpoint: t } = d;
    if (typeof a !== "string" || typeof t !== "string") throw new Error(`OIDC-discovery för ${issuer} saknar authorization_endpoint/token_endpoint.`);
    return { authorizationEndpoint: a, tokenEndpoint: t };
  };
  return () => {
    cached ??= load().catch((err: unknown) => { cached = null; throw err; });
    return cached;
  };
}

export interface OAuthFacadeConfig {
  /** MCP-endpointens publika URL; dess origin är fasadens issuer. */
  resource: URL;
  scopes: string[];
  upstream: () => Promise<UpstreamEndpoints>;
  fetchFn?: Fetch;
}

/** RFC 8414-metadata med AVA som issuer och fasadens två endpoints. */
export function authorizationServerMetadata(config: Pick<OAuthFacadeConfig, "resource" | "scopes">): Record<string, unknown> {
  const base = `${config.resource.origin}${config.resource.pathname}`;
  return {
    issuer: config.resource.origin,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    scopes_supported: config.scopes,
  };
}

/** 302 till IdP:ns authorize med samma parametrar, utom `resource`. */
function authorize(req: Request, upstream: UpstreamEndpoints): Response {
  const target = new URL(upstream.authorizationEndpoint);
  for (const [k, v] of new URL(req.url).searchParams) if (k !== "resource") target.searchParams.append(k, v);
  return new Response(null, { status: 302, headers: { location: target.href, "cache-control": "no-store" } });
}

/** Vidarebefordra token-anropet till IdP:n, utan `resource`. Svaret går oförändrat tillbaka. */
async function token(req: Request, upstream: UpstreamEndpoints, fetchFn: Fetch): Promise<Response> {
  const body = await req.text();
  if (body.length > MAX_TOKEN_BODY) return Response.json({ error: "invalid_request" }, { status: 413 });
  const params = new URLSearchParams(body);
  params.delete("resource");
  const auth = req.headers.get("authorization");
  const res = await fetchFn(upstream.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...(auth ? { authorization: auth } : {}) },
    body: params.toString(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

/** Fetch-handler för metadata + authorize + token. Ger null för andra sökvägar. */
export function createOAuthFacade(config: OAuthFacadeConfig): (req: Request) => Promise<Response | null> {
  const fetchFn = config.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const base = config.resource.pathname;
  return async (req) => {
    const path = new URL(req.url).pathname;
    if (path === AS_METADATA_PATH || path === `${AS_METADATA_PATH}${base}`) {
      return Response.json(authorizationServerMetadata(config), { headers: { "access-control-allow-origin": "*" } });
    }
    if (path === `${base}/authorize` && req.method === "GET") return authorize(req, await config.upstream());
    if (path === `${base}/token` && req.method === "POST") return token(req, await config.upstream(), fetchFn);
    return null;
  };
}
