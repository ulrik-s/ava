/**
 * Förtroendegränsen för identiteten (#1256) — bevisad i konfigurationen.
 *
 * I `forwarded`-läget litar servern på `X-Auth-Request-Email`. Det är säkert
 * bara om (1) servern inte kan nås förbi proxyn, och (2) proxyn alltid skriver
 * över headern med det verifierade värdet. Båda villkoren står i filer som är
 * lätta att ändra av misstag — det här testet fäller en sådan ändring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest-compat";

const DOCKER = join(process.cwd(), "tooling/docker");
const read = (f: string): string => readFileSync(join(DOCKER, f), "utf8");

interface ComposeService { ports?: unknown[]; environment?: Record<string, string> }
const production = yaml.load(read("docker-compose.production.yml")) as { services: Record<string, ComposeService> };

describe("produktionsstackens förtroendegräns (#1256)", () => {
  it("bara Caddy publicerar portar — server-first nås inte förbi proxyn", () => {
    const published = Object.entries(production.services).filter(([, s]) => (s.ports ?? []).length > 0).map(([name]) => name);
    expect(published).toEqual(["caddy"]);
  });

  it("Caddy skriver över identitets-headern och skickar proxyns ID-token vidare (omdöpt)", () => {
    const api = read("caddy/Caddyfile").split("handle /api/*")[1]?.split("reverse_proxy server-first")[0] ?? "";
    expect(api).toContain("forward_auth oauth2-proxy:4180");
    expect(api).toMatch(/copy_headers X-Auth-Request-Email Authorization>X-Ava-Identity-Token/);
  });

  it("oauth2-proxy lägger ID-token i auth-svaret; servern kan slå på verified", () => {
    expect(production.services["oauth2-proxy"]?.environment?.OAUTH2_PROXY_SET_AUTHORIZATION_HEADER).toBe("true");
    const env = production.services["server-first"]?.environment ?? {};
    expect(env.AVA_IDENTITY).toBe("${AVA_IDENTITY:-forwarded}");
    expect(env.AVA_IDENTITY_ISSUER).toContain("OIDC_ISSUER_URL");
  });

  it("nginx (self-hosted-riggen) skriver alltid över X-Auth-Request-Email på /api", () => {
    const api = read("nginx-selfhosted.conf").split("location /api/")[1]?.split("}")[0] ?? "";
    expect(api).toContain("auth_request /oauth2/auth;");
    expect(api).toMatch(/proxy_set_header X-Auth-Request-Email\s+\$auth_email;/);
  });
});
