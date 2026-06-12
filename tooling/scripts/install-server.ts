#!/usr/bin/env bun
/**
 * `install-server` (#232) — guidat, idempotent backend-install-flöde.
 *
 * Sätter upp det "lätt-att-få-fel" (ADR 0008): secrets-valvets master-nyckel
 * (0600, utanför repo), valv-filen + OIDC-secrets i valvet, och en icke-hemlig
 * `.env` för docker-stacken. Skriver ALDRIG över en befintlig master-nyckel
 * eller valv (re-run säkert). Logiken bor i `install-server/core.ts`; den här
 * filen är argv + fs + nästa-steg-utskrift (tunn, jfr server-runtime.ts).
 *
 *   bun tooling/scripts/install-server.ts \
 *     --repo https://git.byra.se/firma.git --work-dir /srv/ava/wc --org <uuid> \
 *     --auth oidc --oidc-issuer https://idp/realms/byra --oidc-client-id ava \
 *     --oidc-client-secret <secret> --oidc-redirect https://app/oauth2/callback
 *
 * Övriga steg (bygg out/ + docker compose up + första-admin-token) skrivs ut
 * som nästa-steg — wizard/orchestrering är en uppföljning på #232.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { EncryptedFileVault, nodeVaultFs } from "@/lib/server/secrets/vault";
import {
  generateMasterKeyBase64,
  generateCookieSecret,
  renderServerEnv,
  planInstall,
  vaultSecretsFor,
  validateInstallConfig,
  VAULT_KEYS,
  type AuthMode,
  type OidcInstallConfig,
  type ServerInstallConfig,
} from "./install-server/core";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function buildOidc(argv: string[]): OidcInstallConfig {
  return {
    issuerUrl: flag(argv, "oidc-issuer") ?? "",
    clientId: flag(argv, "oidc-client-id") ?? "",
    clientSecret: flag(argv, "oidc-client-secret") ?? "",
    redirectUrl: flag(argv, "oidc-redirect") ?? "",
  };
}

function buildConfig(argv: string[], secretsFile: string): ServerInstallConfig {
  const authMode = (flag(argv, "auth") ?? "htpasswd") as AuthMode;
  return {
    repoUrl: flag(argv, "repo") ?? "",
    workDir: flag(argv, "work-dir") ?? "",
    organizationId: flag(argv, "org") ?? "",
    secretsFile,
    authMode,
    ...(authMode === "oidc" ? { oidc: buildOidc(argv) } : {}),
  };
}

function log(msg: string): void {
  console.log(`[install-server] ${msg}`);
}

async function exists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  return access(path).then(() => true).catch(() => false);
}

/** Skriv master-nyckeln 0600 om den saknas; returnera den (befintlig eller ny). */
async function ensureMasterKey(masterKeyFile: string, generate: boolean): Promise<string> {
  const { readFile, writeFile } = await import("node:fs/promises");
  if (!generate) return (await readFile(masterKeyFile, "utf8")).trim();
  const key = generateMasterKeyBase64();
  await writeFile(masterKeyFile, key + "\n", { mode: 0o600 });
  log(`master-nyckel skapad: ${masterKeyFile} (0600) — TAPPA INTE DENNA, valvet blir annars oåterkalleligt`);
  return key;
}

/** Skriv OIDC-secrets i valvet; bevara befintlig cookie-secret (idempotent). */
async function storeVaultSecrets(vault: EncryptedFileVault, cfg: ServerInstallConfig): Promise<void> {
  const existingCookie = await vault.get(VAULT_KEYS.oidcCookieSecret);
  const cookie = existingCookie ?? generateCookieSecret();
  for (const [k, v] of Object.entries(vaultSecretsFor(cfg, cookie))) {
    await vault.set(k, v);
  }
  log("OIDC-secrets skrivna i valvet (client_secret + cookie_secret)");
}

function printNextSteps(cfg: ServerInstallConfig, masterKeyFile: string, envFile: string): void {
  log("klart. Nästa steg:");
  console.log(`
  1. export AVA_SECRETS_KEY=$(cat ${masterKeyFile})
  2. set -a && . ${envFile} && set +a
  3. DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
  4. docker compose -f tooling/docker/docker-compose.yml up -d --build --wait
  5. Hämta första-admin-token ur web-loggen och lägg till användare:
       docker compose -f tooling/docker/docker-compose.yml logs web | grep Admin-token
       bash tooling/scripts/add-user.sh <din-epost>${cfg.authMode === "oidc" ? "\n  6. OIDC: starta även docker-compose.oidc.yml-overlayen." : ""}
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const secretsDir = flag(argv, "secrets-dir") ?? join(homedir(), ".ava-secrets");
  const masterKeyFile = join(secretsDir, "master.key");
  const secretsFile = join(secretsDir, "vault.enc");
  const envFile = flag(argv, "env-out") ?? join(process.cwd(), "ava-server.env");

  const cfg = buildConfig(argv, secretsFile);
  const errors = validateInstallConfig(cfg);
  if (errors.length) {
    for (const e of errors) console.error(`[install-server] FEL: ${e}`);
    process.exitCode = 1;
    return;
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });

  const plan = planInstall(
    { masterKeyExists: await exists(masterKeyFile), vaultExists: await exists(secretsFile) },
    cfg,
  );
  if (!plan.generateMasterKey) log("befintlig master-nyckel behålls (skrivs ej över)");

  const masterKey = await ensureMasterKey(masterKeyFile, plan.generateMasterKey);
  const vault = new EncryptedFileVault(secretsFile, Buffer.from(masterKey, "base64"), nodeVaultFs());
  if (plan.storeSecrets) await storeVaultSecrets(vault, cfg);

  await writeFile(envFile, renderServerEnv(cfg), { mode: 0o600 });
  log(`deploy-env skriven: ${envFile}`);
  printNextSteps(cfg, masterKeyFile, envFile);
}

main().catch((err: unknown) => {
  process.stderr.write(`[install-server] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
