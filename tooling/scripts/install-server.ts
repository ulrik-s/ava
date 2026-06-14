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
import { interpretPreflight, runPreflight } from "./install-server/preflight";
import { checkServices, summarizeServiceChecks } from "./install-server/service-checks";
import { renderTrialRealm } from "./install-server/trial-realm";
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

/** Bygg env för OIDC-overlayen: issuer/client-id/redirect (config) + secrets (valv). */
async function buildOidcStartEnv(
  cfg: ServerInstallConfig,
  vault: EncryptedFileVault,
): Promise<Record<string, string>> {
  if (cfg.authMode !== "oidc" || !cfg.oidc) return {};
  return {
    OIDC_ISSUER_URL: cfg.oidc.issuerUrl,
    OAUTH2_PROXY_CLIENT_ID: cfg.oidc.clientId,
    OIDC_REDIRECT_URL: cfg.oidc.redirectUrl,
    OAUTH2_PROXY_CLIENT_SECRET: (await vault.get(VAULT_KEYS.oidcClientSecret)) ?? "",
    OAUTH2_PROXY_COOKIE_SECRET: (await vault.get(VAULT_KEYS.oidcCookieSecret)) ?? "",
  };
}

const WEB_PORT = 8080;

/** Preflight: docker + web-port. Returnerar false (+ loggar) vid problem. */
async function preflightOk(): Promise<boolean> {
  const { ok, errors } = interpretPreflight(await runPreflight(WEB_PORT));
  if (!ok) {
    for (const e of errors) console.error(`[install-server] preflight: ${e}`);
  }
  return ok;
}

/** Bygg + starta stacken och skriv ut den bootstrappade admin-token:n. */
async function startStack(oidc: boolean, extraEnv: Record<string, string> = {}): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const env = { ...process.env, DEMO_BASE_PATH: "/ava", ...extraEnv };
  await runCommands(buildStartCommands({ oidc }), env);
  const [bin, ...args] = logsCommand(oidc);
  const logs = spawnSync(bin!, args, { encoding: "utf8", env }).stdout ?? "";
  const token = extractAdminToken(logs);
  if (!oidc) {
    log(token ? `admin-token (engångs): ${token} — lägg till användare med add-user.sh` : "admin-token ej funnen i loggen ännu (kolla `docker compose logs web`)");
  }
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

/** Verifiera att den körande installationen NÅR tjänsterna (#323): web, git
 *  smart-HTTP och — vid OIDC — IdP:ns discovery-endpoint. Ren rapport + bool. */
async function runServiceChecks(argv: string[]): Promise<boolean> {
  const cfg = answersToConfig(await gatherAnswers(argv), "");
  const baseUrl = flag(argv, "base-url") ?? `http://localhost:${WEB_PORT}`;
  const repoPath = flag(argv, "repo-path");
  const checks = await checkServices(cfg, { baseUrl, ...(repoPath ? { repoPath } : {}) });
  const { ok, lines } = summarizeServiceChecks(checks);
  for (const l of lines) log(l);
  log(ok ? "alla tjänster svarar." : "en eller flera tjänster svarar INTE — se ovan.");
  return ok;
}

/** Kör tjänste-kontroller mot den lokala stacken + logga raderna (post-start). */
async function reportServiceChecks(cfg: ServerInstallConfig): Promise<void> {
  const { lines } = summarizeServiceChecks(await checkServices(cfg, { baseUrl: `http://localhost:${WEB_PORT}` }));
  for (const l of lines) log(l);
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
    // Ett-kommando-vägen: preflight → exportera valv-nyckeln → bygg → starta.
    if (!(await preflightOk())) return false;
    process.env.AVA_SECRETS_KEY = masterKey;
    process.env.AVA_SECRETS_FILE = paths.secretsFile;
    const oidc = cfg.authMode === "oidc";
    await startStack(oidc, await buildOidcStartEnv(cfg, vault));
    // Verifiera att tjänsterna faktiskt svarar (#323) — rapport, ej hård-fail
    // (vissa kan behöva några sekunder till; kör `--check-services` igen vid behov).
    await reportServiceChecks(cfg);
    if (oidc) {
      log("backenden uppe (OIDC). Seeda första admin + org i firma.git:");
      log(`  bun run bootstrap:admin --work-dir <klon-av-firma.git> --email <din-epost> --org ${cfg.organizationId} --org-name "<Byrå>" --commit`);
      log("Öppna sedan http://localhost:8080/ava/ och logga in via din IdP.");
    } else {
      log("backenden uppe. Lägg till användare med tooling/scripts/add-user.sh.");
    }
    return true;
  }
  printNextSteps(cfg, paths.masterKeyFile, paths.envFile);
  return true;
}

/** Skriv ut en Keycloak trial-realm (#337, ADR 0014 §4) ur flaggor → stdout. */
function printTrialRealm(argv: string[]): boolean {
  const adminEmail = flag(argv, "admin-email");
  const adminPassword = flag(argv, "admin-password");
  const clientSecret = flag(argv, "client-secret");
  if (!adminEmail || !adminPassword || !clientSecret) {
    console.error("[install-server] --print-realm kräver --admin-email, --admin-password och --client-secret");
    return false;
  }
  const realm = renderTrialRealm({
    realm: flag(argv, "realm") ?? "ava",
    adminEmail,
    adminPassword,
    clientId: flag(argv, "client-id") ?? "ava",
    clientSecret,
    redirectUris: (flag(argv, "redirect-uri") ?? "http://localhost:8080/oauth2/callback").split(",").map((s) => s.trim()),
  });
  process.stdout.write(JSON.stringify(realm, null, 2) + "\n");
  return true;
}

/**
 * Icke-install-subkommandon (rena utskrifter / nedrivning / nåbarhetskoll).
 * Returnerar true om ett hanterades → main() ska INTE installera.
 */
async function handleSubcommand(argv: string[]): Promise<boolean> {
  if (hasFlag(argv, "print-config-template")) {
    process.stdout.write(renderConfigTemplate());
    return true;
  }
  // Trial-Keycloak-realm (#337) ur flaggor.
  if (hasFlag(argv, "print-realm")) {
    process.exitCode = printTrialRealm(argv) ? 0 : 1;
    return true;
  }
  // Tjänste-kommunikationskoll (#323): når en körande installation web/git/IdP?
  if (hasFlag(argv, "check-services")) {
    process.exitCode = (await runServiceChecks(argv)) ? 0 : 1;
    return true;
  }
  // Nedrivning: stoppa stacken + ta bort volymer.
  if (hasFlag(argv, "down")) {
    await runCommands(buildStopCommands({ oidc: (flag(argv, "auth") ?? "htpasswd") === "oidc" }), process.env);
    log("stacken nedriven (volymer borttagna). Secrets-valvet är oförändrat.");
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (await handleSubcommand(argv)) return;

  const ok = await runInstall(argv, resolvePaths(argv));
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`[install-server] startfel: ${String(err)}\n`);
  process.exitCode = 1;
});
