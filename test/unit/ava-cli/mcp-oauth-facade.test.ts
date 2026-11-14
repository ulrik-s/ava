/**
 * OAuth-fasaden framför IdP:n (#1026): Entras metadata saknar PKCE-fältet och
 * Entra vägrar `resource` — fasaden rättar båda utan att lagra något.
 */

import { describe, expect, it } from "vitest-compat";
import { createOAuthFacade, upstreamFromIssuer } from "../../../tooling/ava-cli/mcp-oauth-facade";

const UPSTREAM = { authorizationEndpoint: "https://login.example/t/oauth2/v2.0/authorize", tokenEndpoint: "https://login.example/t/oauth2/v2.0/token" };

interface Seen { url: string; init?: RequestInit }

function facade(seen: Seen[] = [], status = 200) {
  return createOAuthFacade({
    resource: new URL("https://ava.example/mcp"),
    scopes: ["api://ava/mcp", "offline_access"],
    upstream: () => Promise.resolve(UPSTREAM),
    fetchFn: (url, init) => {
      seen.push({ url, ...(init ? { init } : {}) });
      return Promise.resolve(new Response('{"access_token":"x"}', { status, headers: { "content-type": "application/json" } }));
    },
  });
}

describe("OAuth-fasaden", () => {
  it("RFC 8414-metadata med AVA som issuer och PKCE utskrivet", async () => {
    const res = await facade()(new Request("https://ava.example/.well-known/oauth-authorization-server"));
    expect(await res?.json()).toEqual({
      issuer: "https://ava.example",
      authorization_endpoint: "https://ava.example/mcp/authorize",
      token_endpoint: "https://ava.example/mcp/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
      scopes_supported: ["api://ava/mcp", "offline_access"],
    });
  });

  it("authorize: 302 till IdP:n med samma parametrar, utan resource", async () => {
    const q = "response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=abc&code_challenge_method=S256&state=s&scope=api%3A%2F%2Fava%2Fmcp&resource=https%3A%2F%2Fava.example%2Fmcp";
    const res = await facade()(new Request(`https://ava.example/mcp/authorize?${q}`));
    expect(res?.status).toBe(302);
    const loc = new URL(res?.headers.get("location") ?? "");
    expect(`${loc.origin}${loc.pathname}`).toBe(UPSTREAM.authorizationEndpoint);
    expect(loc.searchParams.get("resource")).toBeNull();
    expect(loc.searchParams.get("code_challenge")).toBe("abc");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://claude.ai/cb");
    expect(loc.searchParams.get("state")).toBe("s");
  });

  it("token: vidare till IdP:n utan resource, med klientens auth-header; svaret oförändrat", async () => {
    const seen: Seen[] = [];
    const res = await facade(seen, 400)(new Request("https://ava.example/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic Y2xpZW50OnNlY3JldA==" },
      body: "grant_type=authorization_code&code=k&code_verifier=v&resource=https%3A%2F%2Fava.example%2Fmcp",
    }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(UPSTREAM.tokenEndpoint);
    const body = seen[0]?.init?.body;
    const sent = new URLSearchParams(typeof body === "string" ? body : "");
    expect(sent.get("resource")).toBeNull();
    expect(sent.get("code_verifier")).toBe("v");
    expect((seen[0]?.init?.headers as Record<string, string>).authorization).toBe("Basic Y2xpZW50OnNlY3JldA==");
    expect(res?.status).toBe(400);
    expect(await res?.text()).toBe('{"access_token":"x"}');
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });

  it("för stor token-request vidarebefordras inte", async () => {
    const seen: Seen[] = [];
    const res = await facade(seen)(new Request("https://ava.example/mcp/token", { method: "POST", body: "x".repeat(70_000) }));
    expect(res?.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it("andra sökvägar och metoder lämnas vidare", async () => {
    const f = facade();
    expect(await f(new Request("https://ava.example/mcp"))).toBeNull();
    expect(await f(new Request("https://ava.example/mcp/token"))).toBeNull();
  });
});

describe("upstreamFromIssuer", () => {
  it("hämtar endpoints ur discovery en gång och cachar", async () => {
    let calls = 0;
    const up = upstreamFromIssuer("https://login.example/t/v2.0/", (url) => {
      calls++;
      expect(url).toBe("https://login.example/t/v2.0/.well-known/openid-configuration");
      return Promise.resolve(Response.json({ authorization_endpoint: UPSTREAM.authorizationEndpoint, token_endpoint: UPSTREAM.tokenEndpoint }));
    });
    expect(await up()).toEqual(UPSTREAM);
    await up();
    expect(calls).toBe(1);
  });

  it("misslyckad discovery provas igen nästa gång", async () => {
    let calls = 0;
    const up = upstreamFromIssuer("https://login.example/t/v2.0", () => {
      calls++;
      return Promise.resolve(calls === 1 ? new Response("", { status: 500 }) : Response.json({ authorization_endpoint: "a", token_endpoint: "t" }));
    });
    let failed = false;
    try { await up(); } catch { failed = true; }
    expect(failed).toBe(true);
    expect(await up()).toEqual({ authorizationEndpoint: "a", tokenEndpoint: "t" });
  });
});
