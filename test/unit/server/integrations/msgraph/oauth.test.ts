import { describe, it, expect } from "vitest-compat";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
} from "@/lib/server/integrations/msgraph/oauth";
import type { MsGraphConfig } from "@/lib/server/integrations/msgraph/schema";

const config: MsGraphConfig = {
  clientId: "cid",
  clientSecret: "secret",
  tenantId: "tenant-guid",
  redirectUri: "http://localhost:53682/callback",
  scopes: ["offline_access", "https://graph.microsoft.com/Mail.Read"],
  authBase: "https://login.test",
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
  scope: "Mail.Read",
};

function bodyOf(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body));
}

describe("buildAuthorizeUrl", () => {
  it("bygger authorize-URL:en på tenant-scopad v2-endpoint", () => {
    const u = new URL(buildAuthorizeUrl(config, "xyz-state"));
    expect(u.origin + u.pathname).toBe("https://login.test/tenant-guid/oauth2/v2.0/authorize");
    const p = u.searchParams;
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("redirect_uri")).toBe("http://localhost:53682/callback");
    expect(p.get("scope")).toBe("offline_access https://graph.microsoft.com/Mail.Read");
    expect(p.get("state")).toBe("xyz-state");
    expect(p.get("response_type")).toBe("code");
  });

  /**
   * Fortnox-buggen (#1038) spegelvänd. Microsoft kräver att `redirect_uri` ÄR
   * percent-encodad; Fortnox krävde att den INTE var det. Asserten måste därför
   * gå på råsträngen — `u.searchParams.get(…)` decodar och visar samma svar i
   * båda fallen, vilket är precis hur felet kunde ligga kvar hos Fortnox.
   */
  it("percent-encodar redirect_uri i RÅSTRÄNGEN (Microsoft jämför den encodad)", () => {
    const raw = buildAuthorizeUrl(config, "s");
    expect(raw).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcallback");
    expect(raw).not.toContain("redirect_uri=http://localhost");
  });

  it("encodar scope-separatorn — mellanslag i en query-sträng är ett fel", () => {
    expect(buildAuthorizeUrl(config, "s")).toContain("scope=offline_access+https%3A%2F%2Fgraph");
  });

  // Utan detta byter Entra tyst till fragment så fort någon lägger till
  // id_token i response_type — och ett fragment når aldrig callback-servern.
  it("sätter response_mode=query explicit", () => {
    expect(new URL(buildAuthorizeUrl(config, "s")).searchParams.get("response_mode")).toBe("query");
  });
});

describe("exchangeCodeForTokens", () => {
  it("postar authorization_code mot token-endpointen", async () => {
    const cap = {} as Captured;
    await exchangeCodeForTokens(config, "the-code", fakeFetch(200, TOKEN_JSON, cap), 1_000_000);
    expect(cap.url).toBe("https://login.test/tenant-guid/oauth2/v2.0/token");
    const b = bodyOf(cap.init);
    expect(b.get("grant_type")).toBe("authorization_code");
    expect(b.get("code")).toBe("the-code");
    expect(b.get("redirect_uri")).toBe("http://localhost:53682/callback");
  });

  // Entra tar client_secret i kroppen (Basic stöds också). Hamnar den fel
  // svarar endpointen invalid_client, vilket är lätt att misstolka som fel secret.
  it("skickar klientautentiseringen i kroppen", async () => {
    const cap = {} as Captured;
    await exchangeCodeForTokens(config, "c", fakeFetch(200, TOKEN_JSON, cap));
    const b = bodyOf(cap.init);
    expect(b.get("client_id")).toBe("cid");
    expect(b.get("client_secret")).toBe("secret");
  });

  it("räknar utgången med 30 s marginal", async () => {
    const t = await exchangeCodeForTokens(config, "c", fakeFetch(200, TOKEN_JSON), 1_000_000);
    expect(t.accessTokenExpiresAt).toBe(1_000_000 + (3600 - 30) * 1000);
    expect(t.refreshToken).toBe("rt-2");
  });

  // AADSTS-koden är det enda som säger vad som gick fel — tappas den bort står
  // felsökaren med "400" och ingenting mer.
  it("bär med sig felkroppen vid icke-2xx", async () => {
    const err = { error: "invalid_grant", error_description: "AADSTS70008: expired" };
    await expect(exchangeCodeForTokens(config, "c", fakeFetch(400, err)))
      .rejects.toThrow(/AADSTS70008/);
  });

  /**
   * Utan `offline_access` svarar Entra 200 UTAN refresh_token. Skulle det
   * passera tyst vore anslutningen död vid nästa körning, långt från orsaken.
   */
  it("kräver refresh_token och pekar ut offline_access när den saknas", async () => {
    const { refresh_token: _omitted, ...noRefresh } = TOKEN_JSON;
    await expect(exchangeCodeForTokens(config, "c", fakeFetch(200, noRefresh)))
      .rejects.toThrow(/offline_access/);
  });
});

describe("refreshTokens", () => {
  it("postar refresh_token-grant", async () => {
    const cap = {} as Captured;
    await refreshTokens(config, "old-rt", fakeFetch(200, TOKEN_JSON, cap));
    const b = bodyOf(cap.init);
    expect(b.get("grant_type")).toBe("refresh_token");
    expect(b.get("refresh_token")).toBe("old-rt");
  });

  // Rotationen är hela poängen: returneras den gamla token:en tillbaka har
  // write-backen inget nytt att spara och kedjan dör tyst efter en körning.
  it("returnerar den NYA refresh-token:en", async () => {
    const t = await refreshTokens(config, "old-rt", fakeFetch(200, TOKEN_JSON));
    expect(t.refreshToken).toBe("rt-2");
    expect(t.refreshToken).not.toBe("old-rt");
  });
});
