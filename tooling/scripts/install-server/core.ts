/**
 * Install-server-kärnan (#232) — ren, deterministisk logik för det guidade
 * backend-install-flödet. CLI:n (`tooling/scripts/install-server.ts`) gör I/O
 * (fs/docker); HÄR bor bara det "lätt-att-få-fel": nyckel-/secret-generering,
 * env-rendering och en idempotent install-plan (re-run skriver aldrig över en
 * befintlig master-nyckel/valv).
 *
 * Secrets-disciplin (ADR 0008): master-nyckeln + klient-/cookie-secret hamnar
 * ALDRIG i en .env-fil eller i firma.git — master-nyckeln i en 0600-fil utanför
 * repo:t, övriga secrets i det krypterade valvet.
 */

import { randomBytes } from "node:crypto";

export type AuthMode = "htpasswd" | "oidc";

export interface OidcInstallConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface ServerInstallConfig {
  repoUrl: string;
  workDir: string;
  organizationId: string;
  /** Sökväg till den krypterade valv-filen (UTANFÖR git-working-copy:n). */
  secretsFile: string;
  authMode: AuthMode;
  /** Krävs när authMode === "oidc". */
  oidc?: OidcInstallConfig;
}

type RandFn = (size: number) => Buffer;

const MASTER_KEY_BYTES = 32;
const COOKIE_SECRET_BYTES = 32;

/** 32 slumpbyte → base64 (valvets master-nyckel, `AVA_SECRETS_KEY`). */
export function generateMasterKeyBase64(rand: RandFn = randomBytes): string {
  return rand(MASTER_KEY_BYTES).toString("base64");
}

/** 32 slumpbyte → base64url (oauth2-proxy `COOKIE_SECRET`). */
export function generateCookieSecret(rand: RandFn = randomBytes): string {
  return rand(COOKIE_SECRET_BYTES).toString("base64url");
}

/** Valv-nycklar för secrets som aldrig får hamna i env/git. */
export const VAULT_KEYS = {
  oidcClientSecret: "oidc.client_secret",
  oidcCookieSecret: "oidc.cookie_secret",
} as const;

/** Vilka secrets som ska skrivas i valvet för den valda konfigurationen. */
export function vaultSecretsFor(cfg: ServerInstallConfig, cookieSecret: string): Record<string, string> {
  if (cfg.authMode !== "oidc" || !cfg.oidc) return {};
  return {
    [VAULT_KEYS.oidcClientSecret]: cfg.oidc.clientSecret,
    [VAULT_KEYS.oidcCookieSecret]: cookieSecret,
  };
}

/**
 * Rendera den ICKE-hemliga deploy-env:en (.env för docker-stacken). Master-
 * nyckeln + klient-/cookie-secret är MEDVETET INTE med här — de levereras via
 * valvet (`AVA_SECRETS_FILE`) + master-nyckel-filen.
 */
export function renderServerEnv(cfg: ServerInstallConfig): string {
  const lines = [
    "# AVA self-hosted backend — genererad av install-server (#232).",
    "# OBS: AVA_SECRETS_KEY (master-nyckel) + klient-/cookie-secret ligger i",
    "#      secrets-valvet/master-nyckel-filen, ALDRIG här. Vid drift:",
    "#      export AVA_SECRETS_KEY=$(cat <master.key>)",
    `AVA_SECRETS_FILE=${cfg.secretsFile}`,
    `AVA_SR_REPO_URL=${cfg.repoUrl}`,
    `AVA_SR_WORK_DIR=${cfg.workDir}`,
    `AVA_SR_ORG_ID=${cfg.organizationId}`,
    "DEMO_BASE_PATH=/ava",
    `AVA_AUTH_MODE=${cfg.authMode}`,
  ];
  if (cfg.authMode === "oidc" && cfg.oidc) {
    lines.push(
      `OAUTH2_PROXY_CLIENT_ID=${cfg.oidc.clientId}`,
      `OIDC_ISSUER_PUBLIC=${cfg.oidc.issuerUrl}`,
      `OIDC_REDIRECT_URL=${cfg.oidc.redirectUrl}`,
    );
  }
  return lines.join("\n") + "\n";
}

export interface InstallState {
  masterKeyExists: boolean;
  vaultExists: boolean;
}

export interface InstallPlan {
  generateMasterKey: boolean;
  createVault: boolean;
  storeSecrets: boolean;
}

/**
 * Idempotent plan: en befintlig master-nyckel/valv BEHÅLLS (skrivs aldrig över
 * — annars blir valvet oåterkalleligt, ADR 0008). Secrets uppdateras (set är
 * idempotent) när OIDC-läge är valt.
 */
export function planInstall(state: InstallState, cfg: ServerInstallConfig): InstallPlan {
  return {
    generateMasterKey: !state.masterKeyExists,
    createVault: !state.vaultExists,
    storeSecrets: cfg.authMode === "oidc",
  };
}

function oidcComplete(o: OidcInstallConfig | undefined): boolean {
  return Boolean(o?.issuerUrl && o.clientId && o.clientSecret && o.redirectUrl);
}

/** Validera att OIDC-konfig är komplett när authMode === "oidc". */
export function validateInstallConfig(cfg: ServerInstallConfig): string[] {
  const errors: string[] = [];
  const required: ReadonlyArray<readonly [string, string]> = [
    [cfg.repoUrl, "repoUrl saknas"],
    [cfg.workDir, "workDir saknas"],
    [cfg.organizationId, "organizationId saknas"],
    [cfg.secretsFile, "secretsFile saknas"],
  ];
  for (const [val, msg] of required) if (!val) errors.push(msg);
  if (cfg.authMode === "oidc" && !oidcComplete(cfg.oidc)) {
    errors.push("OIDC-läge kräver issuerUrl, clientId, clientSecret och redirectUrl");
  }
  return errors;
}
