/**
 * Remote-MCP över HTTP (#1026): metadata-dokumentet, 401/403-svaren och en
 * riktig MCP-klient genom handlern — med token-verifieringen och callern
 * injicerade (ingen IdP, ingen Postgres, inget nätverk).
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, it } from "vitest-compat";
import type { BearerVerification } from "@/lib/server/http/bearer-claims";
import { createLocalCaller } from "../../tooling/ava-cli/caller";
import { listProcedures } from "../../tooling/ava-cli/introspect";
import { toolName } from "../../tooling/ava-cli/mcp";
import {
  createMcpHttpHandler,
  type McpHttpConfig,
  mcpHttpConfigFromEnv,
  mountMcpFromEnv,
  serverFirstCallerFor,
  withMcp,
} from "../../tooling/ava-cli/mcp-http";

// Klient-SDK:ns SSE-parser ärver TransformStream när modulen laddas. Under
// happy-dom (bunfig-preloaden) blir det happy-doms klass, som Buns strömmar
// inte tar emot ("readable should be ReadableStream"). Avregistrera först och
// ladda klienten sedan. Filen körs isolerat (--isolate), så inget läcker.
await GlobalRegistrator.unregister();
const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");

const CONFIG: McpHttpConfig = {
  resource: new URL("https://ava.example/mcp"),
  authorizationServers: ["https://login.example/tenant/v2.0"],
  scopes: ["api://ava/mcp"],
  verify: { issuer: "https://login.example/tenant/v2.0", jwks: () => Promise.reject(new Error("används inte")) },
};

const GOOD = "good-token";
const verify = (h: string | null): Promise<BearerVerification> => {
  if (!h) return Promise.resolve({ kind: "missing" });
  if (h === "Bearer expired") return Promise.resolve({ kind: "expired" });
  return Promise.resolve(h === `Bearer ${GOOD}` || h === "Bearer unknown-user"
    ? { kind: "verified", claims: { email: "a@b.se", subject: "s", issuer: "i" } }
    : { kind: "invalid" });
};

function handler() {
  return createMcpHttpHandler({
    config: CONFIG,
    procedures: listProcedures(),
    verify,
    callerFor: (token) => Promise.resolve(token === GOOD ? createLocalCaller() : null),
  });
}

describe("remote-MCP över HTTP", () => {
  it("serverar RFC 9728-metadata på båda sökvägarna", async () => {
    const h = handler();
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await h(new Request(`https://ava.example${path}`));
      expect(res?.status).toBe(200);
      expect(await res?.json()).toEqual({
        resource: "https://ava.example/mcp",
        authorization_servers: ["https://login.example/tenant/v2.0"],
        scopes_supported: ["api://ava/mcp"],
        bearer_methods_supported: ["header"],
        resource_name: "AVA",
      });
    }
  });

  it("andra sökvägar lämnas till server-first-API:t", async () => {
    const fallback = () => Promise.resolve(new Response("api"));
    const res = await withMcp(handler(), fallback)(new Request("https://ava.example/api/trpc/x"));
    expect(await res.text()).toBe("api");
  });

  it("utan token: 401 som pekar på metadata-dokumentet, utan invalid_token", async () => {
    const res = await handler()(new Request("https://ava.example/mcp", { method: "POST" }));
    expect(res?.status).toBe(401);
    const challenge = res?.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('resource_metadata="https://ava.example/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('scope="api://ava/mcp"');
    expect(challenge).not.toContain("invalid_token");
  });

  it.each(["Bearer expired", "Bearer forged"])("%s: 401 invalid_token", async (authorization) => {
    const res = await handler()(new Request("https://ava.example/mcp", { method: "POST", headers: { authorization } }));
    expect(res?.status).toBe(401);
    expect(res?.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("giltig token men inte aktiv i byrån: 403", async () => {
    const res = await handler()(new Request("https://ava.example/mcp", { method: "POST", headers: { authorization: "Bearer unknown-user" } }));
    expect(res?.status).toBe(403);
  });

  it("en riktig MCP-klient med giltig token listar och anropar verktygen", async () => {
    const h = handler();
    const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      (await h(new Request(input, init))) ?? new Response("not found", { status: 404 });
    const transport = new StreamableHTTPClientTransport(new URL("https://ava.example/mcp"), {
      fetch: fetchFn,
      requestInit: { headers: { authorization: `Bearer ${GOOD}` } },
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain(toolName("matter.list"));
      const result = await client.callTool({ name: toolName("matter.list"), arguments: {} });
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });
});

describe("serverFirstCallerFor", () => {
  it("bygger kontexten ur en ny request med bara token:en, i verified-läge", async () => {
    let seen: { headers: string[]; mode: string | undefined } | null = null;
    const api = {
      contextFor: (req: Request, overrides?: { identity?: { mode: string } }) => {
        seen = { headers: [...req.headers.keys()], mode: overrides?.identity?.mode };
        return Promise.resolve({ user: null });
      },
    };
    expect(await serverFirstCallerFor(api, CONFIG.verify, () => ({}))(GOOD)).toBeNull();
    expect(seen).toEqual({ headers: ["authorization"], mode: "verified" });
  });

  it("med en principal: en caller över createCaller", async () => {
    const api = { contextFor: () => Promise.resolve({ user: { id: "u" } }) };
    const caller = await serverFirstCallerFor(api, CONFIG.verify, () => ({ matter: { list: () => Promise.resolve(["x"]) } }))(GOOD);
    expect(await caller?.invoke("matter.list", {})).toEqual(["x"]);
  });
});

describe("mountMcpFromEnv", () => {
  const api = { contextFor: () => Promise.resolve({ user: null }), handler: () => Promise.resolve(new Response("api")) };

  it("utan AVA_MCP_RESOURCE: server-first-handlern orörd", () => {
    const mounted = mountMcpFromEnv(api, () => ({}), {});
    expect(mounted.handler).toBe(api.handler);
    expect(mounted.status).toContain("av");
  });

  it("med config: /mcp kräver token, resten går till API:t", async () => {
    const mounted = mountMcpFromEnv(api, () => ({}), {
      AVA_MCP_RESOURCE: "https://ava.example/mcp", AVA_MCP_ISSUER: "https://login.example/t/v2.0", AVA_MCP_AUDIENCE: "a",
    });
    expect(mounted.status).toBe("remote-MCP på https://ava.example/mcp");
    expect((await mounted.handler(new Request("https://ava.example/mcp", { method: "POST" }))).status).toBe(401);
    expect(await (await mounted.handler(new Request("https://ava.example/api/x"))).text()).toBe("api");
  });
});

describe("mcpHttpConfigFromEnv", () => {
  it("av utan AVA_MCP_RESOURCE", () => {
    expect(mcpHttpConfigFromEnv({})).toBeNull();
  });

  it("halvkonfigurerat stoppar starten", () => {
    expect(() => mcpHttpConfigFromEnv({ AVA_MCP_RESOURCE: "https://ava.example/mcp" })).toThrow(/AVA_MCP_ISSUER/);
  });

  it("läser scopes och audience", () => {
    const c = mcpHttpConfigFromEnv({
      AVA_MCP_RESOURCE: "https://ava.example/mcp",
      AVA_MCP_ISSUER: "https://login.example/t/v2.0",
      AVA_MCP_AUDIENCE: "a,b",
      AVA_MCP_SCOPES: "api://ava/mcp offline_access",
    });
    expect(c?.scopes).toEqual(["api://ava/mcp", "offline_access"]);
    expect(c?.verify.audience).toEqual(["a", "b"]);
    expect(c?.authorizationServers).toEqual(["https://login.example/t/v2.0"]);
  });
});
