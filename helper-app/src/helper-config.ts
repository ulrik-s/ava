/**
 * Helper-config-fil (ADR 0029 §config-leverans) — en GUI-app startad från
 * Finder/Start ärver INTE användarens shell-env, så `AVA_OIDC_ISSUER` m.fl. är
 * osatta. Därför läser motorn även en config-fil i data-dir:en
 * (`<dataDir>/helper-config.json`), och env vinner över filen (dev/CLI).
 *
 *   { "oidcIssuer": "https://idp.exempel/realms/ava", "oidcClientId": "ava-helper" }
 *
 * Ren parsning (injicerbar läsare) → testbar. Filen kan i framtiden skrivas av
 * en Inställnings-vy i skalet eller bakas per byrå.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HelperFileConfig {
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcAudience?: string;
  oidcJwksUri?: string;
  oidcScope?: string;
  redirectPort?: number;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Tolka rå JSON → HelperFileConfig (tomt vid trasig JSON). */
function parseConfig(raw: string): HelperFileConfig {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
  const cfg: HelperFileConfig = {};
  const setStr = (key: "oidcIssuer" | "oidcClientId" | "oidcAudience" | "oidcJwksUri" | "oidcScope", v: unknown): void => {
    const s = str(v);
    if (s) cfg[key] = s;
  };
  setStr("oidcIssuer", o.oidcIssuer);
  setStr("oidcClientId", o.oidcClientId);
  setStr("oidcAudience", o.oidcAudience);
  setStr("oidcJwksUri", o.oidcJwksUri);
  setStr("oidcScope", o.oidcScope);
  const port = Number(o.redirectPort);
  if (Number.isInteger(port) && port > 0) cfg.redirectPort = port;
  return cfg;
}

/** Läs `helper-config.json` ur data-dir:en; tomt objekt om den saknas/är trasig. */
export function loadHelperConfig(dir: string | null, readText: (p: string) => string = (p) => readFileSync(p, "utf8")): HelperFileConfig {
  if (!dir) return {};
  try {
    return parseConfig(readText(join(dir, "helper-config.json")));
  } catch {
    return {}; // ingen fil → tom config
  }
}

export interface SaveDeps {
  mkdirp: (dir: string) => void;
  writeText: (path: string, text: string) => void;
}

const defaultSaveDeps: SaveDeps = {
  mkdirp: (dir) => mkdirSync(dir, { recursive: true }),
  writeText: (path, text) => writeFileSync(path, text, "utf8"),
};

/**
 * Skriv `helper-config.json` (ADR 0029) — web-appen postar serverns config hit
 * (`POST /config`) så användaren slipper skapa filen för hand. Returnerar den
 * sparade configen, eller null om `oidcIssuer` saknas / data-dir är otillgänglig.
 */
export function saveHelperConfig(dir: string | null, input: Partial<HelperFileConfig>, deps: SaveDeps = defaultSaveDeps): HelperFileConfig | null {
  if (!dir) return null;
  const issuer = str(input.oidcIssuer);
  if (!issuer) return null; // issuer är minsta nödvändiga
  const clientId = str(input.oidcClientId);
  const audience = str(input.oidcAudience);
  const jwksUri = str(input.oidcJwksUri);
  const cfg: HelperFileConfig = {
    oidcIssuer: issuer,
    ...(clientId ? { oidcClientId: clientId } : {}),
    ...(audience ? { oidcAudience: audience } : {}),
    ...(jwksUri ? { oidcJwksUri: jwksUri } : {}),
  };
  deps.mkdirp(dir);
  deps.writeText(join(dir, "helper-config.json"), JSON.stringify(cfg, null, 2));
  return cfg;
}

/**
 * Lägg fil-configen UNDER env (env vinner) på de `AVA_*`-nycklar motorn läser,
 * så `loginConfigFromEnv` / auth fungerar oavsett hur appen startats.
 */
export function envWithConfig(env: Record<string, string | undefined>, file: HelperFileConfig): Record<string, string | undefined> {
  return {
    ...env,
    AVA_OIDC_ISSUER: env.AVA_OIDC_ISSUER ?? file.oidcIssuer,
    AVA_OIDC_CLIENT_ID: env.AVA_OIDC_CLIENT_ID ?? file.oidcClientId,
    AVA_OIDC_AUDIENCE: env.AVA_OIDC_AUDIENCE ?? file.oidcAudience,
    AVA_OIDC_JWKS_URI: env.AVA_OIDC_JWKS_URI ?? file.oidcJwksUri,
    AVA_OIDC_SCOPE: env.AVA_OIDC_SCOPE ?? file.oidcScope,
    AVA_HELPER_REDIRECT_PORT: env.AVA_HELPER_REDIRECT_PORT ?? file.redirectPort?.toString(),
  };
}
