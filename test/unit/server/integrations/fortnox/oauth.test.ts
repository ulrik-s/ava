import { describe, it, expect } from "vitest-compat";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
} from "@/lib/server/integrations/fortnox/oauth";
import type { FortnoxConfig } from "@/lib/server/integrations/fortnox/schema";

const config: FortnoxConfig = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://app.example/cb",
  scopes: ["bookkeeping", "profile"],
  authBase: "https://auth.test",
  apiBase: "https://api.test",
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, json: unknown, cap?: Captured) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (cap) {
      cap.url = String(url);
      cap.init = init ?? {};
    }
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

const TOKEN_JSON = {
  access_token: "at-1",
  refresh_token: "rt-2",
  token_type: "Bearer",
  expires_in: 3600,
  scope: "bookkeeping",
};

describe("buildAuthorizeUrl", () => {
  it("bygger authorize-URL med rätt parametrar", () => {
    const u = new URL(buildAuthorizeUrl(config, "xyz-state"));
    expect(u.origin + u.pathname).toBe("https://auth.test/oauth-v1/auth");
    const p = u.searchParams;
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("redirect_uri")).toBe("https://app.example/cb");
    expect(p.get("scope")).toBe("bookkeeping profile");
    expect(p.get("state")).toBe("xyz-state");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("account_type")).toBe("service");
  });
});

describe("exchangeCodeForTokens", () => {
  it("POST:ar med Basic-auth + code-grant och räknar ut utgång", async () => {
    const cap = {} as Captured;
    const tokens = await exchangeCodeForTokens(config, "the-code", fakeFetch(200, TOKEN_JSON, cap), 1_000_000);

    expect(cap.url).toBe("https://auth.test/oauth-v1/token");
    const headers = cap.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(cap.init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe("https://app.example/cb");

    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-2");
    // 1_000_000 + (3600 - 30) * 1000
    expect(tokens.accessTokenExpiresAt).toBe(1_000_000 + 3_570_000);
  });

  it("kastar vid icke-2xx", async () => {
    await expect(
      exchangeCodeForTokens(config, "bad", fakeFetch(400, { error: "invalid_grant" })),
    ).rejects.toThrow(/Fortnox token-fel 400/);
  });
});

describe("refreshTokens", () => {
  it("använder refresh-grant och returnerar den ROTERADE refresh-token:en", async () => {
    const cap = {} as Captured;
    const rotated = { ...TOKEN_JSON, access_token: "at-new", refresh_token: "rt-rotated" };
    const tokens = await refreshTokens(config, "rt-old", fakeFetch(200, rotated, cap), 5_000);

    const body = new URLSearchParams(cap.init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-old");
    expect(tokens.accessToken).toBe("at-new");
    expect(tokens.refreshToken).toBe("rt-rotated"); // gamla rt-old är nu ogiltig
    expect(tokens.accessTokenExpiresAt).toBe(5_000 + 3_570_000);
  });
});
