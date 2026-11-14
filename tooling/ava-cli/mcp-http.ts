/**
 * Remote-MCP över HTTP (#1026): samma verktygsyta som `ava-mcp` (stdio), men
 * monterad i server-first-processen på `/mcp`, så att Claude (claude.ai,
 * desktop, mobil) kan koppla upp sig mot byråns riktiga data.
 *
 * Auth enligt MCP-spec:ens OAuth-modell: AVA är *resursserver*, byråns IdP
 * (Entra) utfärdar token:en. Klienten hittar inloggningen via
 * `/.well-known/oauth-protected-resource/mcp` (RFC 9728), som 401-svaret pekar
 * på. Auktoriseringsservern där är AVA:s egen tunna fasad framför IdP:n
 * (mcp-oauth-facade.ts — Entras metadata duger inte för MCP-klienter).
 *
 * Förtroendegränsen: `/mcp` ligger UTANFÖR oauth2-proxy (Caddy släpper den
 * direkt till server-first), så klienten kan skicka vilka `X-Auth-Request-*`
 * den vill. Därför byggs kontexten ur en NY request som bara bär Bearer-
 * token:en, med identitetsläget tvingat till `verified` — samma allowlist,
 * roll och byrå-scoping som webben, och aldrig proxyns headers.
 */

import { createMcpHandler, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import { createRemoteJWKSet } from "jose";
import { type BearerVerification, type BearerVerifyConfig, verifyBearerToken } from "@/lib/server/http/bearer-claims";
import { parseBearerToken } from "@/lib/server/http/pat";
import type { ServerContextDeps } from "@/lib/server/http/server-context";
import { discoveredJwks, parseAudience } from "@/lib/server/http/verified-identity";
import { type AvaCaller, callerFromTrpc } from "./caller";
import { listProcedures, type ProcedureInfo } from "./introspect";
import { buildAvaMcpServer } from "./mcp";
import { createOAuthFacade, upstreamFromIssuer, type UpstreamEndpoints } from "./mcp-oauth-facade";

export const PRM_PREFIX = "/.well-known/oauth-protected-resource";

export interface McpHttpConfig {
  /** MCP-endpointens publika URL, t.ex. `https://ava-crm.io/mcp`. Dess path är rutten. */
  resource: URL;
  /** Auktoriseringsservrarna klienten ska logga in hos (AVA:s fasad = resursens origin). */
  authorizationServers: string[];
  /** IdP:ns endpoints som fasaden skickar vidare till. */
  upstream: () => Promise<UpstreamEndpoints>;
  /** Scopes klienten ska be om, t.ex. `api://<app-id>/mcp`. */
  scopes: string[];
  /** Hur access-token:en verifieras (issuer, audience, JWKS). */
  verify: BearerVerifyConfig;
}

type Env = Record<string, string | undefined>;
const envValue = (env: Env, key: string): string | undefined => env[key]?.trim() || undefined;

/**
 * Config ur miljön, eller null när remote-MCP är av (`AVA_MCP_RESOURCE` osatt).
 * Halvkonfigurerat stoppar starten: hellre ingen /mcp än en som inte verifierar.
 *
 *   - `AVA_MCP_RESOURCE`   publik URL, t.ex. https://ava-crm.io/mcp
 *   - `AVA_MCP_ISSUER`     IdP:ns issuer (Entra v2: https://login.microsoftonline.com/<tenant>/v2.0)
 *   - `AVA_MCP_AUDIENCE`   token:ens `aud` (Entra: API-appens klient-id), kommaseparerat för flera
 *   - `AVA_MCP_SCOPES`     scopes att annonsera, mellanslags- eller kommaseparerade
 *   - `AVA_MCP_JWKS_URI`   valfri; annars OIDC-discovery ur issuern
 */
export function mcpHttpConfigFromEnv(env: Env = process.env): McpHttpConfig | null {
  const resource = envValue(env, "AVA_MCP_RESOURCE");
  if (!resource) return null;
  const issuer = envValue(env, "AVA_MCP_ISSUER");
  const audience = parseAudience(envValue(env, "AVA_MCP_AUDIENCE"));
  if (!issuer || !audience) throw new Error("AVA_MCP_RESOURCE kräver AVA_MCP_ISSUER och AVA_MCP_AUDIENCE.");
  const jwksUri = envValue(env, "AVA_MCP_JWKS_URI");
  return {
    resource: new URL(resource),
    authorizationServers: [new URL(resource).origin],
    upstream: upstreamFromIssuer(issuer),
    scopes: (envValue(env, "AVA_MCP_SCOPES") ?? "").split(/[\s,]+/).filter(Boolean),
    verify: { issuer, audience, jwks: jwksUri ? createRemoteJWKSet(new URL(jwksUri)) : discoveredJwks(issuer) },
  };
}

/** RFC 9728-dokumentet: var klienten loggar in och vilka scopes den ska be om. */
export function protectedResourceMetadata(config: McpHttpConfig): Record<string, unknown> {
  return {
    resource: config.resource.href,
    authorization_servers: config.authorizationServers,
    scopes_supported: config.scopes,
    bearer_methods_supported: ["header"],
    resource_name: "AVA",
  };
}

/** 401 med `WWW-Authenticate` som pekar på metadata-dokumentet (MCP-spec:en, RFC 6750). */
function unauthorized(config: McpHttpConfig, kind: BearerVerification["kind"]): Response {
  const params = [`resource_metadata="${getOAuthProtectedResourceMetadataUrl(config.resource)}"`];
  if (config.scopes.length > 0) params.push(`scope="${config.scopes.join(" ")}"`);
  // Saknad token är ingen felaktig token: då ska klienten bara logga in.
  if (kind !== "missing") params.push(`error="invalid_token"`);
  const body = kind === "expired" ? "Inloggningens token har gått ut." : "Ingen giltig inloggning.";
  return Response.json({ error: kind === "missing" ? "unauthorized" : "invalid_token", error_description: body }, {
    status: 401,
    headers: { "www-authenticate": `Bearer ${params.join(", ")}` },
  });
}

export interface McpHttpDeps {
  config: McpHttpConfig;
  procedures: readonly ProcedureInfo[];
  /** En caller som kör som token:ens användare, eller null om hen inte är aktiv i byrån. */
  callerFor: (token: string) => Promise<AvaCaller | null>;
  /** Injicerbar för test; default `verifyBearerToken` mot `config.verify`. */
  verify?: (authorization: string | null) => Promise<BearerVerification>;
}

/**
 * Fetch-handler för `/mcp` och metadata-dokumentet. Ger `null` för alla andra
 * sökvägar, så att den kan ligga före server-first-API:t.
 */
export function createMcpHttpHandler(deps: McpHttpDeps): (req: Request) => Promise<Response | null> {
  const { config } = deps;
  const verify = deps.verify ?? ((h: string | null) => verifyBearerToken(h, config.verify));
  const mcpPath = config.resource.pathname;
  const prmPaths = new Set([PRM_PREFIX, `${PRM_PREFIX}${mcpPath}`]);
  const callers = new WeakMap<object, AvaCaller>();
  const oauth = createOAuthFacade({ resource: config.resource, scopes: config.scopes, upstream: config.upstream });
  // En McpServer per request (SDK:ns modell), byggd med just den requestens caller.
  const mcp = createMcpHandler((ctx) => {
    const caller = ctx.authInfo ? callers.get(ctx.authInfo) : undefined;
    if (!caller) throw new Error("remote-MCP: ingen caller för requesten");
    return buildAvaMcpServer(deps.procedures, caller);
  }, { legacy: "stateless" });

  return async (req) => {
    const path = new URL(req.url).pathname;
    if (prmPaths.has(path)) return Response.json(protectedResourceMetadata(config), { headers: { "access-control-allow-origin": "*" } });
    const facade = await oauth(req);
    if (facade) return facade;
    if (path !== mcpPath) return null;
    const authorization = req.headers.get("authorization");
    const identity = await verify(authorization);
    const token = parseBearerToken(authorization);
    if (identity.kind !== "verified" || !token) return unauthorized(config, identity.kind);
    const caller = await deps.callerFor(token);
    if (!caller) {
      return Response.json(
        { error: "access_denied", error_description: "Kontot är inte aktivt i byrån — kontakta administratören." },
        { status: 403 },
      );
    }
    const authInfo = { token, clientId: "", scopes: config.scopes };
    callers.set(authInfo, caller);
    return mcp.fetch(req, { authInfo });
  };
}

/** Det server-first-API:t remote-MCP behöver (smal yta → lätt att testa). */
export interface ContextSource<C extends { user: unknown }> {
  contextFor: (req: Request, overrides?: Partial<ServerContextDeps>) => Promise<C>;
}

/**
 * `callerFor` mot server-first: kontexten ur en NY request med bara token:en,
 * i `verified`-läge (se förtroendegränsen överst). Ingen principal → null.
 * `createCaller` är `appRouter.createCaller` (injicerad: testbar utan db).
 */
export function serverFirstCallerFor<C extends { user: unknown }>(
  api: ContextSource<C>,
  verify: BearerVerifyConfig,
  createCaller: (ctx: C) => unknown,
): (token: string) => Promise<AvaCaller | null> {
  return async (token) => {
    const req = new Request("http://mcp.internal/mcp", { headers: { authorization: `Bearer ${token}` } });
    const ctx = await api.contextFor(req, { identity: { mode: "verified", verify }, bearer: verify });
    return ctx.user ? callerFromTrpc(createCaller(ctx)) : null;
  };
}

/**
 * server-first-handlern med /mcp framför, om remote-MCP är konfigurerat i
 * miljön. Ger också en rad för startloggen.
 */
export function mountMcpFromEnv<C extends { user: unknown }>(
  api: ContextSource<C> & { handler: (req: Request) => Promise<Response> },
  createCaller: (ctx: C) => unknown,
  env: Env = process.env,
): { handler: (req: Request) => Promise<Response>; status: string } {
  const config = mcpHttpConfigFromEnv(env);
  if (!config) return { handler: api.handler, status: "remote-MCP av (AVA_MCP_RESOURCE osatt)" };
  const mcp = createMcpHttpHandler({ config, procedures: listProcedures(), callerFor: serverFirstCallerFor(api, config.verify, createCaller) });
  return { handler: withMcp(mcp, api.handler), status: `remote-MCP på ${config.resource.href}` };
}

/** `mcp` först, annars `fallback` — så monteras /mcp framför server-first-API:t. */
export function withMcp(
  mcp: (req: Request) => Promise<Response | null>,
  fallback: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => (await mcp(req)) ?? fallback(req);
}
