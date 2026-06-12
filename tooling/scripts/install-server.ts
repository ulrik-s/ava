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
  type ServerInstallConfig,
} from "./install-server/core";
import {
  buildStartCommands,
  buildStopCommands,
  logsCommand,
  extractAdminToken,
} from "./install-server/orchestrate";
import {
  answersToConfig,
  renderConfigTemplate,
  parseConfigFile,
} from "./install-server/wizard";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** Kör en kommandosekvens (ärver stdio); kasta vid första misslyckande. */
async function runCommands(cmds: string[][], env: NodeJS.ProcessEnv): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  for (const [bin, ...args] of cmds) {
    log(`$ ${bin} ${args.join(" ")}`);
    const r = spawnSync(bin!, args, { stdio: "inherit", env });
    if (r.status !== 0) throw new Error(`kommandot misslyckades (${r.status ?? r.signal}): ${bin}`);
  }
}

/** Bygg + starta stacken och skriv ut den bootstrappade admin-token:n. */
async function startStack(oidc: boolean): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  await runCommands(buildStartCommands({ oidc }), { ...process.env, DEMO_BASE_PATH: "/ava" });
  const [bin, ...args] = logsCommand(oidc);
  const logs = spawnSync(bin!, args, { encoding: "utf8" }).stdout ?? "";
  const token = extractAdminToken(logs);
  log(token ? `admin-token (engångs): ${token} — lägg till användare med add-user.sh` : "admin-token ej funnen i loggen ännu (kolla `docker compose logs web`)");
}

const ANSWER_KEYS = [
  "repo", "work-dir", "org", "auth",
  "oidc-issuer", "oidc-client-id", "oidc-client-secret", "oidc-redirect",
] as const;

/** Plocka kända flaggor till en svar-map (flagg-vägen). */
function argvToAnswers(argv: string[]): Record<string, string | undefined> {
  const answers: Record<string, string | undefined> = {};
  for (const key of ANSWER_KEYS) answers[key] = flag(argv, key);
  return answers;
}

/** Slå ihop config-fil (om angiven) med flaggor — flaggor vinner. */
async function gatherAnswers(argv: string[]): Promise<Record<string, string | undefined>> {
  const configPath = flag(argv, "config");
  const fromFlags = argvToAnswers(argv);
  if (!configPath) return fromFlags;
  const { readFile } = await import("node:fs/promises");
  const fromFile = parseConfigFile(await readFile(configPath, "utf8"));
  // Flaggor vinner över filen (tillåter override per körning).
  const merged: Record<string, string | undefined> = { ...fromFile };
  for (const [k, v] of Object.entries(fromFlags)) if (v !== undefined) merged[k] = v;
  return merged;
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

interface InstallPaths {
  secretsDir: string;
  masterKeyFile: string;
  secretsFile: string;
  envFile: string;
}

function resolvePaths(argv: string[]): InstallPaths {
  const secretsDir = flag(argv, "secrets-dir") ?? join(homedir(), ".ava-secrets");
  return {
    secretsDir,
    masterKeyFile: join(secretsDir, "master.key"),
    secretsFile: join(secretsDir, "vault.enc"),
    envFile: flag(argv, "env-out") ?? join(process.cwd(), "ava-server.env"),
  };
}

/** Secrets-valv + env-bootstrap (+ valfri start). Returnerar false vid config-fel. */
async function runInstall(argv: string[], paths: InstallPaths): Promise<boolean> {
  const answers = await gatherAnswers(argv);
  const cfg = answersToConfig(answers, paths.secretsFile);
  const errors = validateInstallConfig(cfg);
  if (errors.length) {
    for (const e of errors) console.error(`[install-server] FEL: ${e}`);
    return false;
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });

  const plan = planInstall(
    { masterKeyExists: await exists(paths.masterKeyFile), vaultExists: await exists(paths.secretsFile) },
    cfg,
  );
  if (!plan.generateMasterKey) log("befintlig master-nyckel behålls (skrivs ej över)");

  const masterKey = await ensureMasterKey(paths.masterKeyFile, plan.generateMasterKey);
  const vault = new EncryptedFileVault(paths.secretsFile, Buffer.from(masterKey, "base64"), nodeVaultFs());
  if (plan.storeSecrets) await storeVaultSecrets(vault, cfg);

  await writeFile(paths.envFile, renderServerEnv(cfg), { mode: 0o600 });
  log(`deploy-env skriven: ${paths.envFile}`);

  if (hasFlag(argv, "start")) {
    // Ett-kommando-vägen: exportera valv-nyckeln + bygg + starta + verifiera.
    process.env.AVA_SECRETS_KEY = masterKey;
    process.env.AVA_SECRETS_FILE = paths.secretsFile;
    await startStack(cfg.authMode === "oidc");
    log("backenden uppe. Lägg till användare med tooling/scripts/add-user.sh.");
    return true;
  }
  printNextSteps(cfg, paths.masterKeyFile, paths.envFile);
  return true;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Skriv ut en config-mall att fylla i (--config-vägen). Inga sidoeffekter.
  if (hasFlag(argv, "print-config-template")) {
    process.stdout.write(renderConfigTemplate());
    return;
  }

  // Avinstallation/nedrivning: stoppa stacken + ta bort volymer, sen klart.
  if (hasFlag(argv, "down")) {
    await runCommands(buildStopCommands({ oidc: (flag(argv, "auth") ?? "htpasswd") === "oidc" }), process.env);
    log("stacken nedriven (volymer borttagna). Secrets-valvet är oförändrat.");
    return;
  }

  const ok = await runInstall(argv, resolvePaths(argv));
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`[install-server] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
