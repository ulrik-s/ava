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
import { SESSION_KEEPALIVE_INTERVAL_MS } from "@/lib/client/auth/session-keepalive";

interface ComposeService { environment?: Record<string, string> }
const proxyEnv = (file: string): Record<string, string> => {
  const compose = Bun.YAML.parse(readFileSync(join(process.cwd(), "tooling/docker", file), "utf8")) as { services: Record<string, ComposeService> };
  return compose.services["oauth2-proxy"]?.environment ?? {};
};

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

  // Keepalive:n (#1425) sparar förnyelsen via /oauth2/userinfo. Anropen till
  // /api mellan att sessionen passerat COOKIE_REFRESH och nästa fråga förnyar
  // utan att spara — intervallet måste vara en liten del av COOKIE_REFRESH.
  for (const stack of STACKS.filter((s) => s.entra)) {
    it(`${stack.file}: klientens keepalive frågar väl inom COOKIE_REFRESH (#1425)`, () => {
      const refreshMs = seconds(defaultOf(proxyEnv(stack.file).OAUTH2_PROXY_COOKIE_REFRESH)) * 1000;
      expect(SESSION_KEEPALIVE_INTERVAL_MS * 4).toBeLessThanOrEqual(refreshMs);
    });
  }

  it("varaktighets-tolkningen avvisar det den inte känner igen", () => {
    expect(() => seconds("1d")).toThrow(/okänd varaktighet/);
  });
});
