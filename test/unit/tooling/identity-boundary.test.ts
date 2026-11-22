/**
 * Förtroendegränsen för identiteten (#1256) — bevisad i konfigurationen.
 *
 * Prod-stacken kör `verified` som standard (#1880): servern godtar bara en
 * signerad token, med issuer och audience ur oauth2-proxys obligatoriska
 * variabler. Reservläget `forwarded` litar på `X-Auth-Request-Email`. Det är
 * säkert bara om (1) servern inte kan nås förbi proxyn, och (2) proxyn alltid
 * skriver över headern med det verifierade värdet. Villkoren står i filer som
 * är lätta att ändra av misstag — det här testet fäller en sådan ändring.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";

const DOCKER = join(process.cwd(), "tooling/docker");
const read = (f: string): string => readFileSync(join(DOCKER, f), "utf8");

interface ComposeService {
  ports?: unknown[];
  environment?: Record<string, string>;
  networks?: string[] | Record<string, unknown>;
  network_mode?: string;
}
const parseCompose = (f: string): { services?: Record<string, ComposeService> } =>
  Bun.YAML.parse(read(f)) as { services?: Record<string, ComposeService> };
const production = parseCompose("docker-compose.production.yml") as { services: Record<string, ComposeService> };
const serverFirstEnv = (f: string): Record<string, string> | undefined => parseCompose(f).services?.["server-first"]?.environment;
const COMPOSE_FILES = readdirSync(DOCKER).filter((f) => /^docker-compose.*\.yml$/.test(f));

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

  it("oauth2-proxy lägger ID-token i auth-svaret; servern kör verified som standard (#1880)", () => {
    const proxy = production.services["oauth2-proxy"]?.environment ?? {};
    expect(proxy.OAUTH2_PROXY_SET_AUTHORIZATION_HEADER).toBe("true");
    const env = production.services["server-first"]?.environment ?? {};
    expect(env.AVA_IDENTITY).toBe("${AVA_IDENTITY:-verified}");
    expect(env.AVA_IDENTITY_ISSUER).toBe("${OIDC_ISSUER_URL:-}");
    expect(proxy.OAUTH2_PROXY_OIDC_ISSUER_URL?.startsWith("${OIDC_ISSUER_URL:?")).toBe(true);
    expect(env.AVA_IDENTITY_AUDIENCE).toBe("${AVA_IDENTITY_AUDIENCE:-${OAUTH2_PROXY_CLIENT_ID:-}}");
    expect(proxy.OAUTH2_PROXY_CLIENT_ID?.startsWith("${OAUTH2_PROXY_CLIENT_ID:?")).toBe(true);
  });

  it("återställningsövningen kör forwarded — markören skapas utan proxy (#1880)", () => {
    expect(serverFirstEnv("docker-compose.drill.yml")?.AVA_IDENTITY).toBe("forwarded");
  });

  it("nginx (self-hosted-riggen) skriver alltid över X-Auth-Request-Email på /api", () => {
    const api = read("nginx-selfhosted.conf").split("location /api/")[1]?.split("}")[0] ?? "";
    expect(api).toContain("auth_request /oauth2/auth;");
    expect(api).toMatch(/proxy_set_header X-Auth-Request-Email\s+\$auth_email;/);
  });
});

/** Tjänstens nät som en sorterad lista; `network_mode: none` blir `["none"]`. */
const networksOf = (s: ComposeService): string[] => {
  if (s.network_mode !== undefined) return [s.network_mode];
  const nets = s.networks ?? [];
  return (Array.isArray(nets) ? [...nets] : Object.keys(nets)).sort();
};

describe("produktionsstackens nät (#1879)", () => {
  it("varje tjänst har sina nät uttryckligen eller network_mode: none", () => {
    const implicit = Object.entries(production.services)
      .filter(([, s]) => s.network_mode !== "none" && networksOf(s).length === 0)
      .map(([name]) => name);
    expect(implicit).toEqual([]);
  });

  it("kartan tjänst → nät är exakt den beslutade", () => {
    const map = Object.fromEntries(Object.entries(production.services).map(([name, s]) => [name, networksOf(s)]));
    expect(map).toEqual({
      caddy: ["edge"],
      "oauth2-proxy": ["edge"],
      postgres: ["default"],
      "server-first": ["default", "edge", "llm"],
      autoheal: ["none"],
      ollama: ["llm"],
    });
  });

  it("toppnivån har edge och llm, och inget nät är internal", () => {
    const { networks } = Bun.YAML.parse(read("docker-compose.production.yml")) as {
      networks?: Record<string, { internal?: boolean } | null>;
    };
    expect(Object.keys(networks ?? {}).sort()).toEqual(["edge", "llm"]);
    expect(Object.values(networks ?? {}).filter((n) => n?.internal === true)).toEqual([]);
  });

  it("networksOf läser nät som karta (aliases) lika väl som lista", () => {
    expect(networksOf({ networks: { default: { aliases: ["x"] }, edge: null } })).toEqual(["default", "edge"]);
  });
});

describe("Bearer-vägen kräver audience i varje stack (#1800)", () => {
  it("prod-composen: tomt AVA_HELPER_OIDC_AUDIENCE betyder helperns klient-id", () => {
    expect(serverFirstEnv("docker-compose.production.yml")?.AVA_OIDC_AUDIENCE).toBe(
      "${AVA_HELPER_OIDC_AUDIENCE:-${AVA_HELPER_OIDC_CLIENT_ID:-}}",
    );
  });

  it("självhostnings-riggen: audience är ava (Keycloak-mappern ger aud = ava)", () => {
    expect(serverFirstEnv("docker-compose.selfhosted-local.yml")?.AVA_OIDC_AUDIENCE).toBe("ava");
  });

  it("varje compose-fil som sätter AVA_OIDC_ISSUER sätter också en icke-tom AVA_OIDC_AUDIENCE", () => {
    const withIssuer = COMPOSE_FILES.filter((f) => serverFirstEnv(f)?.AVA_OIDC_ISSUER !== undefined);
    expect(withIssuer.length).toBeGreaterThan(0);
    const missing = withIssuer.filter((f) => !serverFirstEnv(f)?.AVA_OIDC_AUDIENCE);
    expect(missing).toEqual([]);
  });
});

describe("dev-stacken publicerar server-first bara på loopback (#1882)", () => {
  it("server-first-porten är bunden till 127.0.0.1 — inte till alla gränssnitt", () => {
    const dev = parseCompose("docker-compose.server-first.yml");
    expect(dev.services?.["server-first"]?.ports).toEqual(["127.0.0.1:3001:3001"]);
  });
});
