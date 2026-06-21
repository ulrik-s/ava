/**
 * Helper-auth-kärnan (ADR 0028 §2): PKCE, OIDC-discovery/exchange/refresh,
 * keychain-token-store och refresh-manager. Allt IO injicerat → IdP-oberoende
 * (ingen Keycloak krävs).
 */

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  buildAuthorizeUrl,
  discoverOidc,
  exchangeCode,
  refreshTokens,
  type FetchLike,
  type OidcEndpoints,
} from "../src/engine/auth/oidc.ts";
import { generatePkce, randomState } from "../src/engine/auth/pkce.ts";
import { TokenManager } from "../src/engine/auth/token-manager.ts";
import {
  clearArgs,
  InMemoryTokenStore,
  KeychainTokenStore,
  loadArgs,
  parseStored,
  saveArgs,
  type CaptureRunner,
} from "../src/engine/auth/token-store.ts";

const EP: OidcEndpoints = {
  issuer: "https://idp/realms/ava",
  authorizationEndpoint: "https://idp/realms/ava/protocol/openid-connect/auth",
  tokenEndpoint: "https://idp/realms/ava/protocol/openid-connect/token",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("PKCE", () => {
  test("challenge = base64url(SHA256(verifier)), method S256", () => {
    const pkce = generatePkce(() => Buffer.from("0123456789abcdef0123456789abcdef"));
    expect(pkce.method).toBe("S256");
    const expected = createHash("sha256").update(pkce.verifier).digest().toString("base64url");
    expect(pkce.challenge).toBe(expected);
  });

  test("base64url-säker (inga +/=/ tecken)", () => {
    const pkce = generatePkce();
    expect(pkce.verifier).not.toMatch(/[+/=]/);
    expect(pkce.challenge).not.toMatch(/[+/=]/);
  });

  test("randomState ger olika värden", () => {
    expect(randomState()).not.toBe(randomState());
  });
});

describe("buildAuthorizeUrl", () => {
  test("sätter PKCE + response_type + state", () => {
    const url = new URL(buildAuthorizeUrl(EP, { clientId: "ava", redirectUri: "http://127.0.0.1:9999/callback", challenge: "CH", state: "ST" }));
    expect(url.origin + url.pathname).toBe(EP.authorizationEndpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("ava");
    expect(url.searchParams.get("code_challenge")).toBe("CH");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("ST");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:9999/callback");
  });
});

describe("discoverOidc", () => {
  test("plockar authorization/token-endpoints", async () => {
    const fetchFn = (async () => jsonResponse({ issuer: EP.issuer, authorization_endpoint: EP.authorizationEndpoint, token_endpoint: EP.tokenEndpoint })) satisfies FetchLike;
    expect(await discoverOidc(EP.issuer, fetchFn)).toEqual(EP);
  });

  test("kastar vid icke-ok", async () => {
    const fetchFn = (async () => new Response("no", { status: 404 })) satisfies FetchLike;
    await expect(discoverOidc(EP.issuer, fetchFn)).rejects.toThrow(/discovery HTTP 404/);
  });

  test("kastar vid saknade endpoints", async () => {
    const fetchFn = (async () => jsonResponse({ issuer: EP.issuer })) satisfies FetchLike;
    await expect(discoverOidc(EP.issuer, fetchFn)).rejects.toThrow(/saknar/);
  });
});

describe("exchangeCode + refreshTokens", () => {
  test("exchange POST:ar rätt grant + sätter expiresAt ur now+expires_in", async () => {
    let seenBody = "";
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body);
      return jsonResponse({ access_token: "AT", refresh_token: "RT", expires_in: 300 });
    }) satisfies FetchLike;
    const t = await exchangeCode(EP, { clientId: "ava", code: "C", verifier: "V", redirectUri: "http://127.0.0.1/cb" }, fetchFn, () => 1_000);
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresAt: 1_000 + 300_000 });
    expect(seenBody).toContain("grant_type=authorization_code");
    expect(seenBody).toContain("code_verifier=V");
  });

  test("refresh POST:ar refresh_token-grant", async () => {
    let seenBody = "";
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body);
      return jsonResponse({ access_token: "AT2", expires_in: 60 });
    }) satisfies FetchLike;
    const t = await refreshTokens(EP, { clientId: "ava", refreshToken: "RT" }, fetchFn, () => 0);
    expect(t.accessToken).toBe("AT2");
    expect(t.expiresAt).toBe(60_000);
    expect(seenBody).toContain("grant_type=refresh_token");
  });

  test("kastar vid token HTTP-fel", async () => {
    const fetchFn = (async () => new Response("bad", { status: 400 })) satisfies FetchLike;
    await expect(refreshTokens(EP, { clientId: "ava", refreshToken: "x" }, fetchFn)).rejects.toThrow(/token HTTP 400/);
  });

  test("kastar vid saknat access_token", async () => {
    const fetchFn = (async () => jsonResponse({ refresh_token: "only" })) satisfies FetchLike;
    await expect(exchangeCode(EP, { clientId: "ava", code: "C", verifier: "V", redirectUri: "u" }, fetchFn)).rejects.toThrow(/saknar access_token/);
  });
});

describe("token-store (keychain args + parse)", () => {
  test("saveArgs är idempotent (-U) med rätt account/service", () => {
    const args = saveArgs("SECRET");
    expect(args).toContain("-U");
    expect(args[args.length - 1]).toBe("SECRET");
    expect(args).toContain("ava-helper");
  });

  test("parseStored: giltig JSON → TokenSet; skräp → null", () => {
    expect(parseStored(JSON.stringify({ accessToken: "AT", expiresAt: 5 }))).toMatchObject({ accessToken: "AT", expiresAt: 5 });
    expect(parseStored("")).toBeNull();
    expect(parseStored("{ trasig")).toBeNull();
    expect(parseStored(JSON.stringify({ accessToken: "AT" }))).toBeNull(); // saknar expiresAt
  });

  test("KeychainTokenStore round-trip via injicerad runner", async () => {
    let stored = "";
    const run: CaptureRunner = (_cmd, args) => {
      if (args[0] === "add-generic-password") { stored = args[args.length - 1]!; return { status: 0, stdout: "" }; }
      if (args[0] === "find-generic-password") return { status: stored ? 0 : 1, stdout: stored };
      return { status: 0, stdout: "" };
    };
    const store = new KeychainTokenStore(run);
    await store.save({ accessToken: "AT", refreshToken: "RT", expiresAt: 123 });
    expect(await store.load()).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresAt: 123 });
  });

  test("KeychainTokenStore.load → null när secret saknas (status≠0)", async () => {
    const run: CaptureRunner = () => ({ status: 1, stdout: "" });
    expect(await new KeychainTokenStore(run).load()).toBeNull();
  });

  test("KeychainTokenStore.clear anropar security delete-generic-password", async () => {
    let cleared = false;
    const run: CaptureRunner = (_cmd, args) => { if (args[0] === "delete-generic-password") cleared = true; return { status: 0, stdout: "" }; };
    await new KeychainTokenStore(run).clear();
    expect(cleared).toBe(true);
  });

  test("loadArgs/clearArgs har rätt account+service", () => {
    expect(loadArgs()).toEqual(["find-generic-password", "-a", "ava-helper", "-s", "ava-helper-oidc-token", "-w"]);
    expect(clearArgs()).toEqual(["delete-generic-password", "-a", "ava-helper", "-s", "ava-helper-oidc-token"]);
  });

  test("InMemoryTokenStore: save → load → clear → null", async () => {
    const store = new InMemoryTokenStore();
    expect(await store.load()).toBeNull();
    await store.save({ accessToken: "AT", expiresAt: 1 });
    expect(await store.load()).toMatchObject({ accessToken: "AT" });
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe("TokenManager", () => {
  function mgr(store: InMemoryTokenStore, now: number, refresh = (): Promise<never> => Promise.reject(new Error("no refresh"))) {
    return new TokenManager(store, EP, "ava", { now: () => now, refresh: refresh as never });
  }

  test("giltig (ej snart utgången) → returnerar access-token utan refresh", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "AT", refreshToken: "RT", expiresAt: 1_000_000 });
    expect(await mgr(store, 0).getAccessToken()).toBe("AT");
  });

  test("ej parad (tom store) → null", async () => {
    expect(await mgr(new InMemoryTokenStore(), 0).getAccessToken()).toBeNull();
  });

  test("snart utgången + refresh-token → förnyar och sparar", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "OLD", refreshToken: "RT", expiresAt: 10_000 });
    const refreshed = { accessToken: "NEW", refreshToken: "RT2", expiresAt: 999_999 };
    const m = mgr(store, 9_999, () => Promise.resolve(refreshed) as never);
    expect(await m.getAccessToken()).toBe("NEW");
    expect(await store.load()).toMatchObject({ accessToken: "NEW" }); // persisterat
  });

  test("utgången utan refresh-token → rensar store + null", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "OLD", expiresAt: 10_000 });
    expect(await mgr(store, 999_999).getAccessToken()).toBeNull();
    expect(await store.load()).toBeNull(); // rensad
  });

  test("refresh kastar → null (om-parning krävs)", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "OLD", refreshToken: "RT", expiresAt: 10_000 });
    expect(await mgr(store, 999_999, () => Promise.reject(new Error("revoked")) as never).getAccessToken()).toBeNull();
  });

  test("authHeader formaterar Bearer", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "AT", refreshToken: "RT", expiresAt: 1_000_000 });
    expect(await mgr(store, 0).authHeader()).toBe("Bearer AT");
    expect(await mgr(new InMemoryTokenStore(), 0).authHeader()).toBeNull();
  });

  test("default-deps (utan injektion): giltig token returneras (täcker default now)", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3_600_000 });
    const m = new TokenManager(store, EP, "ava"); // inga deps → default now/refresh
    expect(await m.getAccessToken()).toBe("AT");
  });
});
