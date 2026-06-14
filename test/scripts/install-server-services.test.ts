/**
 * Test för install-server tjänste-kommunikationskontroller (#323):
 * checkOidcIssuer / checkWeb / checkGitHttp / checkServices / summarize.
 * fetch injiceras → inga riktiga tjänster.
 */

import { describe, it, expect, vi } from "vitest-compat";
import type { ServerInstallConfig } from "../../tooling/scripts/install-server/core";
import {
  checkOidcIssuer,
  checkWeb,
  checkGitHttp,
  checkServices,
  summarizeServiceChecks,
} from "../../tooling/scripts/install-server/service-checks";

const htpasswdCfg: ServerInstallConfig = {
  repoUrl: "https://git.ex/firma.git", workDir: "/wc", organizationId: "org-1",
  secretsFile: "/v.enc", authMode: "htpasswd",
};
const oidcCfg: ServerInstallConfig = {
  ...htpasswdCfg, authMode: "oidc",
  oidc: { issuerUrl: "https://idp.ex/realms/byra", clientId: "ava", clientSecret: "s", redirectUrl: "https://app/oauth2/callback" },
};

describe("checkOidcIssuer", () => {
  it("200 + authorization_endpoint → ok, träffar discovery-URL:en", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ authorization_endpoint: "https://idp.ex/auth" }), { status: 200 }));
    const r = await checkOidcIssuer("https://idp.ex/realms/byra/", f);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledWith("https://idp.ex/realms/byra/.well-known/openid-configuration");
  });

  it("200 men utan authorization_endpoint → fail", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ issuer: "x" }), { status: 200 }));
    expect((await checkOidcIssuer("https://idp.ex", f)).ok).toBe(false);
  });

  it("404 → fail med statuskod i detalj", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 404 }));
    const r = await checkOidcIssuer("https://idp.ex", f);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("404");
  });

  it("nätfel (throw) → fail, inte kasta", async () => {
    const f = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const r = await checkOidcIssuer("https://idp.ex", f);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("ECONNREFUSED");
  });
});

describe("checkWeb", () => {
  it("200 + 'AVA' i body → ok", async () => {
    const f = vi.fn(async () => new Response("<html><title>AVA</title></html>", { status: 200 }));
    expect((await checkWeb("http://localhost:8080", f)).ok).toBe(true);
  });

  it("200 men saknar AVA-markör → fail (stale out/)", async () => {
    const f = vi.fn(async () => new Response("<h1>nginx</h1>", { status: 200 }));
    const r = await checkWeb("http://localhost:8080", f);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/markör|stale/i);
  });

  it("anropar /ava/", async () => {
    const f = vi.fn(async () => new Response("AVA", { status: 200 }));
    await checkWeb("http://localhost:8080/", f);
    expect(f).toHaveBeenCalledWith("http://localhost:8080/ava/");
  });
});

describe("checkGitHttp", () => {
  it("200 → ok", async () => {
    const f = vi.fn(async () => new Response("", { status: 200 }));
    expect((await checkGitHttp("http://localhost:8080", "firma.git", f)).ok).toBe(true);
  });

  it("401 → ok (auth krävs men nåbar)", async () => {
    const f = vi.fn(async () => new Response("", { status: 401 }));
    const r = await checkGitHttp("http://localhost:8080", "firma.git", f);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/auth krävs/);
  });

  it("500 → fail", async () => {
    const f = vi.fn(async () => new Response("", { status: 500 }));
    expect((await checkGitHttp("http://localhost:8080", "firma.git", f)).ok).toBe(false);
  });

  it("bygger info/refs-URL:en med upload-pack-service", async () => {
    const f = vi.fn(async () => new Response("", { status: 200 }));
    await checkGitHttp("http://localhost:8080/", "/firma.git", f);
    expect(f).toHaveBeenCalledWith("http://localhost:8080/git/firma.git/info/refs?service=git-upload-pack");
  });
});

describe("checkServices", () => {
  const okFetch = vi.fn(async (url: string) => {
    if (url.includes("openid-configuration")) return new Response(JSON.stringify({ authorization_endpoint: "x" }), { status: 200 });
    if (url.includes("/git/")) return new Response("", { status: 401 });
    return new Response("AVA", { status: 200 });
  });

  it("htpasswd: bara web + git (ingen OIDC-koll)", async () => {
    const checks = await checkServices(htpasswdCfg, { baseUrl: "http://localhost:8080", fetchFn: okFetch });
    expect(checks.map((c) => c.name).sort()).toEqual(["git smart-HTTP", "web"]);
  });

  it("oidc: web + git + OIDC issuer", async () => {
    const checks = await checkServices(oidcCfg, { baseUrl: "http://localhost:8080", fetchFn: okFetch });
    expect(checks.map((c) => c.name).sort()).toEqual(["OIDC issuer", "git smart-HTTP", "web"]);
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});

describe("summarizeServiceChecks", () => {
  it("ok=true bara när alla ok; rader prefixas med ✓/✗", () => {
    const s = summarizeServiceChecks([
      { name: "web", ok: true, detail: "200" },
      { name: "git smart-HTTP", ok: false, detail: "500" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.lines[0]).toMatch(/^✓ web/);
    expect(s.lines[1]).toMatch(/^✗ git/);
  });
});
