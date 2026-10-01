/**
 * oauth2-proxy förnyar sessionen (#1351) i varje stack som kör den.
 *
 * Utan `COOKIE_REFRESH` dog sessionen när ID-token gick ut (en timme hos
 * Entra), och i `verified`-läget fick servern en utgången token — 401 med
 * beskedet "kontot spärrat". Förnyelsen måste ske före tokenets livstid och
 * före cookiens utgång (annars vägrar proxyn starta).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";

interface ComposeService {
  image?: string;
  command?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  healthcheck?: { test?: string[] };
  depends_on?: Record<string, { condition?: string }> | string[];
  networks?: { default?: { aliases?: string[] } };
}
interface ComposeFile { services: Record<string, ComposeService>; volumes?: Record<string, unknown> }
const compose = (file: string): ComposeFile =>
  Bun.YAML.parse(readFileSync(join(process.cwd(), "tooling/docker", file), "utf8")) as ComposeFile;
const proxyEnv = (file: string): Record<string, string> => compose(file).services["oauth2-proxy"]?.environment ?? {};

/** `${VAR:-30m}` → `30m`; ett rent värde lämnas som det är. */
const defaultOf = (value: string | undefined): string => /:-([^}]*)\}/.exec(value ?? "")?.[1] ?? value ?? "";

const UNIT_S: Record<string, number> = { s: 1, m: 60, h: 3600 };
/** `30m`/`168h`/`90s` → sekunder (bara formerna stackarna använder). */
function seconds(duration: string): number {
  const match = /^(\d+)([smh])$/.exec(duration);
  if (!match?.[1] || !match[2]) throw new Error(`okänd varaktighet: ${duration}`);
  return Number(match[1]) * (UNIT_S[match[2]] ?? 0);
}

const ENTRA_ID_TOKEN_S = 3600;
const TEST_REALM_TOKEN_S = 300; // tooling/docker/keycloak/realm-ava.json accessTokenLifespan
const OFFLINE_GRACE_S = 7 * 24 * 3600;

// entra = riktig drift mot Entra; testriggarna kastar sessionerna med flit.
const STACKS = [
  { file: "docker-compose.production.yml", tokenLifetime: ENTRA_ID_TOKEN_S, entra: true },
  { file: "docker-compose.oidc-byoidp.yml", tokenLifetime: ENTRA_ID_TOKEN_S, entra: true },
  { file: "docker-compose.oidc.yml", tokenLifetime: TEST_REALM_TOKEN_S, entra: false },
  { file: "docker-compose.selfhosted-local.yml", tokenLifetime: TEST_REALM_TOKEN_S, entra: false },
];

describe("oauth2-proxy förnyar sessionen (#1351)", () => {
  for (const stack of STACKS) {
    it(`${stack.file}: förnyar före tokenets livstid och före cookiens utgång (= offline-grace)`, () => {
      const env = proxyEnv(stack.file);
      const refresh = seconds(defaultOf(env.OAUTH2_PROXY_COOKIE_REFRESH));
      const expire = seconds(defaultOf(env.OAUTH2_PROXY_COOKIE_EXPIRE));
      expect(refresh).toBeGreaterThan(0);
      expect(refresh).toBeLessThan(stack.tokenLifetime);
      expect(refresh).toBeLessThan(expire);
      expect(expire).toBe(OFFLINE_GRACE_S);
      if (stack.entra) expect(defaultOf(env.OAUTH2_PROXY_SCOPE)).toContain("offline_access");
    });
  }

  it("varaktighets-tolkningen avvisar det den inte känner igen", () => {
    expect(() => seconds("1d")).toThrow(/okänd varaktighet/);
  });
});

/**
 * Förnyelsen sparas på serversidan (#1425). Caddys forward_auth och nginx
 * auth_request skickar aldrig auth-svarets Set-Cookie till browsern — med
 * sessionen i cookien gick varje förnyelse via /oauth2/auth förlorad och
 * proxyn förnyade mot IdP:n på varje API-anrop. Varje stack har proxyn bakom
 * en sådan auth-subrequest, så varje stack måste ha sessionen i redis.
 */
describe("oauth2-proxy har sessionen i redis (#1425)", () => {
  for (const stack of STACKS) {
    it(`${stack.file}: redis-sessionslager som proxyn väntar in`, () => {
      const file = compose(stack.file);
      const proxy = file.services["oauth2-proxy"];
      const redis = file.services.redis;
      expect(proxy?.environment?.OAUTH2_PROXY_SESSION_STORE_TYPE).toBe("redis");
      expect(proxy?.environment?.OAUTH2_PROXY_REDIS_CONNECTION_URL).toBe("redis://redis:6379");
      expect(redis?.image).toMatch(/^redis:7/);
      expect(redis?.healthcheck?.test).toEqual(["CMD", "redis-cli", "ping"]);
      expect(proxy?.depends_on).toMatchObject({ redis: { condition: "service_healthy" } });
    });
  }

  for (const stack of STACKS.filter((s) => s.entra)) {
    it(`${stack.file}: sessionerna överlever omstart (appendonly + namngiven volym)`, () => {
      const file = compose(stack.file);
      const redis = file.services.redis;
      expect(redis?.command).toEqual(["redis-server", "--appendonly", "yes"]);
      expect(redis?.volumes).toEqual(["redis_data:/data"]);
      expect(Object.keys(file.volumes ?? {})).toContain("redis_data");
    });
  }

  it("OIDC-E2E:n kör den riktiga prod-Caddyfile:n framför proxyn", () => {
    const { services } = compose("docker-compose.oidc.yml");
    expect(services.caddy?.volumes).toContain("./caddy/Caddyfile:/etc/caddy/Caddyfile:ro");
    expect(services["api-echo"]?.networks?.default?.aliases).toEqual(["server-first"]);
    const echo = readFileSync(join(process.cwd(), "tooling/docker/caddy/api-echo.Caddyfile"), "utf8");
    expect(echo).toContain(":3001");
    expect(echo).toContain("{header.X-Auth-Request-Email}");
  });
});
