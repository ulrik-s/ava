/**
 * Auth-orchestrering (ADR 0028 §2 del 2): callback-parsing/-server, login-flödet,
 * auth-header-providern och kö-token-injektionen. Allt IO injicerat → testbart
 * utan browser/IdP/keychain.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { asId } from "@/lib/shared/schemas/ids";

import { buildAuthHeaderProvider } from "../src/engine/auth/auth-provider.ts";
import { parseCallback, waitForCallback } from "../src/engine/auth/callback-server.ts";
import { loginConfigFromEnv, runLogin, type LoginDeps } from "../src/engine/auth/login.ts";
import type { OidcEndpoints } from "../src/engine/auth/oidc.ts";
import { InMemoryTokenStore } from "../src/engine/auth/token-store.ts";
import { UploadQueue } from "../src/engine/queue.ts";

const EP: OidcEndpoints = {
  issuer: "https://idp/realms/ava",
  authorizationEndpoint: "https://idp/realms/ava/auth",
  tokenEndpoint: "https://idp/realms/ava/token",
};

describe("parseCallback", () => {
  test("giltig → code", () => {
    expect(parseCallback("http://127.0.0.1:48765/callback?code=C&state=ST", "ST")).toEqual({ code: "C" });
  });
  test("fel state → state-mismatch", () => {
    expect(parseCallback("/callback?code=C&state=BAD", "ST")).toEqual({ error: "state-mismatch" });
  });
  test("error-param vidarebefordras", () => {
    expect(parseCallback("/callback?error=access_denied&state=ST", "ST")).toEqual({ error: "access_denied" });
  });
  test("fel path → not-callback", () => {
    expect(parseCallback("/nope?code=C&state=ST", "ST")).toEqual({ error: "not-callback" });
  });
  test("saknad code → missing-code", () => {
    expect(parseCallback("/callback?state=ST", "ST")).toEqual({ error: "missing-code" });
  });
});

describe("waitForCallback (injicerad serve)", () => {
  test("giltig callback → resolvar code + svarar 200 + stänger servern", async () => {
    let handler!: (req: Request) => Response;
    let stopped = false;
    const serve = (_port: number, h: (req: Request) => Response) => { handler = h; return { stop: () => { stopped = true; } }; };
    const p = waitForCallback(48765, "ST", { serve, timeoutMs: 1000 });
    const res = handler(new Request("http://127.0.0.1:48765/callback?code=C&state=ST"));
    expect(res.status).toBe(200);
    expect(await p).toBe("C");
    expect(stopped).toBe(true);
  });

  test("fel state → rejectar + svarar 400", async () => {
    let handler!: (req: Request) => Response;
    const serve = (_p: number, h: (req: Request) => Response) => { handler = h; return { stop: () => {} }; };
    const p = waitForCallback(48765, "ST", { serve, timeoutMs: 1000 });
    const res = handler(new Request("http://127.0.0.1:48765/callback?code=C&state=WRONG"));
    expect(res.status).toBe(400);
    await expect(p).rejects.toThrow(/state-mismatch/);
  });

  test("ingen callback → timeout rejectar", async () => {
    const serve = () => ({ stop: () => {} });
    await expect(waitForCallback(48765, "ST", { serve, timeoutMs: 10 })).rejects.toThrow(/timeout/);
  });
});

describe("loginConfigFromEnv", () => {
  test("null utan issuer", () => {
    expect(loginConfigFromEnv({})).toBeNull();
  });
  test("defaultar clientId + redirect-port", () => {
    expect(loginConfigFromEnv({ AVA_OIDC_ISSUER: EP.issuer })).toMatchObject({ issuer: EP.issuer, clientId: "ava-helper", redirectPort: 48765 });
  });
  test("respekterar overrides", () => {
    const c = loginConfigFromEnv({ AVA_OIDC_ISSUER: EP.issuer, AVA_OIDC_CLIENT_ID: "custom", AVA_HELPER_REDIRECT_PORT: "9000" });
    expect(c).toMatchObject({ clientId: "custom", redirectPort: 9000 });
  });
});

describe("runLogin (injicerade deps)", () => {
  test("discover→pkce→authorize→callback→exchange→store", async () => {
    const store = new InMemoryTokenStore();
    let openedUrl = "";
    let exchangeArgs: { code: string; verifier: string; redirectUri: string } | undefined;
    const deps: LoginDeps = {
      discover: async () => EP,
      makePkce: () => ({ verifier: "V", challenge: "CH", method: "S256" }),
      makeState: () => "ST",
      openUrl: async (u) => { openedUrl = u; },
      awaitCallback: async () => "CODE",
      exchange: async (_ep, p) => { exchangeArgs = { code: p.code, verifier: p.verifier, redirectUri: p.redirectUri }; return { accessToken: "AT", refreshToken: "RT", expiresAt: 1 }; },
      store,
    };
    expect(await runLogin({ issuer: EP.issuer, clientId: "ava-helper", redirectPort: 48765 }, deps)).toBe(true);

    const u = new URL(openedUrl);
    expect(u.searchParams.get("code_challenge")).toBe("CH");
    expect(u.searchParams.get("state")).toBe("ST");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:48765/callback");
    expect(exchangeArgs).toEqual({ code: "CODE", verifier: "V", redirectUri: "http://127.0.0.1:48765/callback" });
    expect(await store.load()).toMatchObject({ accessToken: "AT" });
  });
});

describe("buildAuthHeaderProvider", () => {
  const NOW = 1_000_000;
  function deps(discoverImpl: () => Promise<OidcEndpoints>, managerHeader: string | null) {
    return {
      now: () => NOW,
      discover: discoverImpl,
      makeManager: () => ({ authHeader: async () => managerHeader }),
    };
  }

  test("ej parad → undefined", async () => {
    const provider = buildAuthHeaderProvider({ issuer: EP.issuer, clientId: "ava-helper" }, new InMemoryTokenStore(), deps(async () => EP, null));
    expect(await provider()).toBeUndefined();
  });

  test("giltig token → Bearer UTAN discovery (hot-path)", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "AT", expiresAt: NOW + 3_600_000 });
    let discovered = false;
    const provider = buildAuthHeaderProvider({ issuer: EP.issuer, clientId: "ava-helper" }, store, deps(async () => { discovered = true; return EP; }, null));
    expect(await provider()).toBe("Bearer AT");
    expect(discovered).toBe(false);
  });

  test("snart utgången → discover + manager-refresh", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "OLD", refreshToken: "RT", expiresAt: NOW + 1000 });
    const provider = buildAuthHeaderProvider({ issuer: EP.issuer, clientId: "ava-helper" }, store, deps(async () => EP, "Bearer NEW"));
    expect(await provider()).toBe("Bearer NEW");
  });

  test("discovery kastar → undefined (faller tillbaka)", async () => {
    const store = new InMemoryTokenStore();
    await store.save({ accessToken: "OLD", refreshToken: "RT", expiresAt: NOW });
    const provider = buildAuthHeaderProvider({ issuer: EP.issuer, clientId: "ava-helper" }, store, deps(async () => { throw new Error("idp down"); }, "Bearer NEW"));
    expect(await provider()).toBeUndefined();
  });
});

describe("UploadQueue tokenProvider (autonom Bearer vid drain)", () => {
  const dirs: string[] = [];
  async function qdir(): Promise<string> { const d = await mkdtemp(join(tmpdir(), "ava-q-tok-")); dirs.push(d); return d; }
  async function cleanup(): Promise<void> { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); }

  test("post utan egen authHeader → använder färsk token vid upload", async () => {
    const puts: Array<string | undefined> = [];
    const deps = { now: () => 1000, newId: () => "id1", put: async (_u: string, _b: Uint8Array, auth?: string) => { puts.push(auth); return 200; }, uploadDoc: async () => ({ status: "ok" as const, version: 1 }), saveConflictCopy: async () => ({ id: asId<"DocumentId">("c"), fileName: "k" }) };
    const q = new UploadQueue(await qdir(), deps, async () => "Bearer FRESH");
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: new TextEncoder().encode("x") });
    await q.drainOnce();
    expect(puts[0]).toBe("Bearer FRESH");
    await cleanup();
  });

  test("post MED egen authHeader → den vinner över token-providern", async () => {
    const puts: Array<string | undefined> = [];
    const deps = { now: () => 1000, newId: () => "id2", put: async (_u: string, _b: Uint8Array, auth?: string) => { puts.push(auth); return 200; }, uploadDoc: async () => ({ status: "ok" as const, version: 1 }), saveConflictCopy: async () => ({ id: asId<"DocumentId">("c"), fileName: "k" }) };
    const q = new UploadQueue(await qdir(), deps, async () => "Bearer FRESH");
    await q.enqueue({ uploadUrl: "http://s/u/2", fileName: "a", bytes: new TextEncoder().encode("x"), authHeader: "Bearer BROWSER" });
    await q.drainOnce();
    expect(puts[0]).toBe("Bearer BROWSER");
    await cleanup();
  });
});
