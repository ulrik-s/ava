/**
 * ava-helper — liten localhost-bryggar-app som låter AVA-webbapparna
 * öppna dokument i native-editorer (PDF Gear, Word, Preview …) och synka
 * tillbaka ändringarna, samt öppna mail-appen med en bilaga.
 *
 * Designprinciper (oförändrade från Go-versionen):
 *   - Tier-agnostisk: helpern vet inget om AVA:s backend (git/Postgres).
 *   - Localhost-only: lyssnar på 127.0.0.1:48761.
 *   - CORS-whitelist mot AVA:s origins.
 *   - Self-update mot GitHub releases; exit 0 efter uppdatering →
 *     service-runnern startar om med nya bytsen.
 *
 * Byggs till en fristående binär med `bun build --compile` (se build.ts),
 * delar protokoll-typer med webbappen via @/lib/shared/helper/protocol (#78).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { HELPER_HTTPS_PORT, HELPER_PORT } from "@/lib/shared/helper/protocol";
import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";

import { buildAuthHeaderProvider } from "./auth/auth-provider.ts";
import { loginConfigFromEnv, runLogin, type LoginConfig } from "./auth/login.ts";
import { handleConfig } from "./config-endpoint.ts";
import { ContentStore, resolveCacheTtlMs } from "./content-store.ts";
import { fetchAndCacheContent, handleContent } from "./content.ts";
import { envWithConfig, loadHelperConfig, saveHelperConfig } from "./helper-config.ts";
import { installService, uninstallService, type InstallDeps } from "./install.ts";
import { initLog, log } from "./log.ts";
import {
  defaultOpenDeps,
  defaultWatchDeps,
  downloadTo,
  enqueueSavedFile,
  handleOpen,
  persistDownloaded,
  restoreCached,
  watchAndUpload,
  type OpenDeps,
} from "./open.ts";
import { dataDir } from "./paths.ts";
import { currentPlatform } from "./platform/runtime.ts";
import { UploadQueue } from "./queue.ts";
import { createHandler } from "./server.ts";
import { loadOrCreateTls } from "./tls/certs.ts";
import { installCaTrust, removeCaTrust } from "./tls/trust.ts";
import { checkOnce, runUpdateLoop, type UpdateConfig } from "./update.ts";
import { VERSION } from "./version.ts";

function extraOrigins(): string[] {
  return (process.env.AVA_HELPER_ORIGINS ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}

/** Lyssningsport: AVA_HELPER_PORT om satt (e2e-test/ops), annars default. */
function listenPort(): number {
  const p = Number(process.env.AVA_HELPER_PORT);
  return Number.isInteger(p) && p > 0 ? p : HELPER_PORT;
}

function httpsPort(): number {
  const p = Number(process.env.AVA_HELPER_HTTPS_PORT);
  return Number.isInteger(p) && p > 0 ? p : HELPER_HTTPS_PORT;
}

/** `--install-trust` / `--uninstall-trust`: lägg/ta bort CA i macOS-keychain. */
function handleTrust(action: "install" | "uninstall"): void {
  const dir = dataDir();
  if (dir === null) {
    process.stderr.write("ingen data-dir tillgänglig\n");
    process.exitCode = 1;
    return;
  }
  const tlsDir = join(dir, "tls");
  loadOrCreateTls(tlsDir); // säkerställ att CA finns
  const caPath = join(tlsDir, "ca.pem");
  const res = action === "install" ? installCaTrust(caPath) : removeCaTrust(caPath);
  const label = `CA-trust ${action}`;
  process.stdout.write(
    res.skipped ? `${label}: hoppad (${res.reason ?? ""})\n` : `${label}: ${res.ok ? "ok" : "misslyckades"}\n`,
  );
  if (!res.ok && !res.skipped) process.exitCode = 1;
}

/** Riktiga OS-/fs-deps för self-install (#86). */
function installDeps(): InstallDeps {
  return {
    mkdirp: (dir) => mkdirSync(dir, { recursive: true }),
    copyFile: (from, to) => copyFileSync(from, to),
    chmodExec: (path) => chmodSync(path, 0o755),
    writeFile: (path, content) => writeFileSync(path, content, "utf8"),
    run: (cmd, args) => { spawnSync(cmd, args, { stdio: "inherit" }); },
    installTrust: () => handleTrust("install"),
    log: (msg) => process.stdout.write(`${msg}\n`),
  };
}

/** `--install` / `--uninstall`: registrera/avregistrera helpern som user-service. */
function handleInstall(action: "install" | "uninstall"): void {
  const ok =
    action === "install"
      ? installService(currentPlatform(), homedir(), process.execPath, installDeps())
      : uninstallService(currentPlatform(), homedir(), installDeps());
  if (!ok) process.exitCode = 1;
}

type Handler = (req: Request) => Promise<Response>;

/**
 * Starta HTTPS parallellt med HTTP (ADR 0006). Genererar/laddar lokalt TLS-
 * material i data-dir. Returnerar undefined om data-dir saknas eller TLS
 * inte kan startas — HTTP fortsätter ändå (Chromium/Firefox behöver inte HTTPS).
 */
function startHttpsServer(handler: Handler, dir: string | null, port: number): ReturnType<typeof serveFetchHandler> | undefined {
  if (dir === null) {
    log("ingen data-dir → hoppar över HTTPS (endast HTTP)");
    return undefined;
  }
  try {
    const tls = loadOrCreateTls(join(dir, "tls"));
    const server = serveFetchHandler(handler, {
      port,
      hostname: "127.0.0.1",
      tls: { cert: tls.leaf.cert, key: tls.leaf.key },
      onError: (err) => log(`HTTPS-server-fel (fortsätter med HTTP): ${err.message}`),
    });
    log(`ava-helper HTTPS på localhost:${port}`);
    return server;
  } catch (err) {
    log(`HTTPS-start misslyckades (fortsätter med HTTP): ${String(err)}`);
    return undefined;
  }
}

function buildUpdateConfig(): UpdateConfig {
  return {
    currentVersion: VERSION,
    repo: "ulrik-s/ava",
    tagFilter: "helper-",
    checkIntervalMs: 24 * 60 * 60_000,
    initialDelayMs: 5 * 60_000,
    onUpdated: (newVersion) => {
      log(`self-update klar (${VERSION} → ${newVersion}) — exiterar för restart`);
      process.exit(0);
    },
  };
}

/**
 * `/open`-hanterare som gör dokument-livscykeln offline-first (ADR 0028 §3):
 * watch-loopen ENQUEUE:ar varje save i den durabla kön (i st.f. direkt-PUT),
 * nedladdade bytes cachas content-adresserat (persist) och en cachad kopia
 * återställs (restore) om nedladdning misslyckas offline.
 */
/** Färsk `Authorization`-header från helperns OIDC-token, eller undefined. */
type AuthHeaderProvider = () => Promise<string | undefined>;

export function queueBackedOnOpen(queue: UploadQueue, content: ContentStore, authHeader?: AuthHeaderProvider): (req: Request) => Promise<Response> {
  // Browserns authHeader först; annars helperns egen OIDC-token (autonom, ADR 0028 §2).
  const fallback = async (browserAuth: string | undefined): Promise<string | undefined> =>
    browserAuth ?? (authHeader ? await authHeader() : undefined);
  const deps: OpenDeps = {
    ...defaultOpenDeps,
    download: async (path, url, browserAuth) => downloadTo(path, url, await fallback(browserAuth)),
    startWatch: (path, uploadUrl, authHeaderArg, timeoutMs) =>
      watchAndUpload(path, uploadUrl, authHeaderArg, timeoutMs, {
        ...defaultWatchDeps,
        upload: (p, url, auth) => enqueueSavedFile(queue, p, url, auth),
      }),
    persist: (url, path, fileName) => persistDownloaded(content, url, path, fileName),
    restore: (url, path) => restoreCached(content, url, path),
  };
  return (req) => handleOpen(req, deps);
}

/** De durabla lagren (kö + content) när data-dir finns. */
interface Stores {
  queue: UploadQueue;
  content: ContentStore;
}

/** Skapa + återställ kön + content-lagret (om data-dir finns) och starta dränerings-loopen. */
function startStores(dir: string | null, signal: AbortSignal, authHeader?: AuthHeaderProvider): Stores | undefined {
  if (dir === null) {
    log("ingen data-dir → durabla lager inaktiverade (direkt-upload, ingen offline-cache)");
    return undefined;
  }
  // Kön får token-providern → drar färsk Bearer vid varje upload-försök (ADR 0028 §2).
  const queue = new UploadQueue(join(dir, "queue"), undefined, authHeader);
  void queue.recover().then(() => queue.startDrainLoop(signal));
  const content = new ContentStore(join(dir, "content"));
  content.startEvictionLoop(signal, resolveCacheTtlMs(process.env.AVA_HELPER_CACHE_TTL_DAYS));
  return { queue, content };
}

export interface EngineOpts {
  /** Lyssningsport (default `AVA_HELPER_PORT`/48761). */
  port?: number;
  /** HTTPS-port (default `AVA_HELPER_HTTPS_PORT`/48762). */
  httpsPort?: number;
  /** Data-dir-override (default OS-dir). Sätts i test för hermetik. */
  dataDir?: string | null;
}

export interface EngineHandle {
  port: number;
  stop: () => void;
}

/**
 * Starta motorn: HTTP(S)-servrar + durabla lager + handlers + OIDC-auth.
 * Återanvänds av CLI-/headless-entryn OCH Electron-skalet (ADR 0030) — all
 * logik bor här, inte i Electron, så motorn kan köras + debuggas headless.
 */
export function startEngine(opts: EngineOpts = {}): EngineHandle {
  const port = opts.port ?? listenPort();
  const hsPort = opts.httpsPort ?? httpsPort();
  const dir = opts.dataDir !== undefined ? opts.dataDir : dataDir();
  log(`ava-helper ${VERSION} startar på 127.0.0.1:${port}`);

  const updateCfg = buildUpdateConfig();
  const abort = new AbortController();
  void runUpdateLoop(updateCfg, abort.signal);

  // Helperns egen OIDC-auth (om parad/konfigurerad) → autonom Bearer mot servern.
  const loginCfg = loginConfigFromEnv(helperEnvFor(dir));
  const authHeader: AuthHeaderProvider | undefined = loginCfg ? buildAuthHeaderProvider(loginCfg) : undefined;

  const stores = startStores(dir, abort.signal, authHeader);
  const handler = createHandler({
    version: VERSION,
    extraOrigins: extraOrigins(),
    onCheckUpdate: () => { void checkOnce(updateCfg).catch((err) => log(`check-update: ${String(err)}`)); },
    // Auto-konfigurering från web-appen (ADR 0029) — alltid på (skriver helper-config.json).
    onConfig: (req: Request) => handleConfig(req, { save: (input) => saveHelperConfig(dir, input) }),
    ...(stores
      ? {
          onOpen: queueBackedOnOpen(stores.queue, stores.content, authHeader),
          onStatus: () => stores.queue.snapshot(),
          onContent: (req: Request) =>
            handleContent(req, {
              load: (url) => stores.content.load(url),
              fetchAndCache: async (url, auth, fileName) =>
                fetchAndCacheContent(stores.content, url, auth ?? (authHeader ? await authHeader() : undefined), fileName),
            }),
        }
      : {}),
  });

  const httpServer = serveFetchHandler(handler, {
    port,
    hostname: "127.0.0.1",
    onError: (err) => log(`HTTP-server-fel: ${err.message}`),
  });
  const httpsServer = startHttpsServer(handler, dir, hsPort);
  return {
    port,
    stop: () => { abort.abort(); httpServer.close(); httpsServer?.close(); },
  };
}

/** Env överlagrad med config-filen — så config funkar för en GUI-app som inte
 *  ärver shell-env (ADR 0029). */
function helperEnvFor(dir: string | null): Record<string, string | undefined> {
  return envWithConfig(process.env, loadHelperConfig(dir));
}
function helperEnv(): Record<string, string | undefined> {
  return helperEnvFor(dataDir());
}

/**
 * Lös ut helperns OIDC-login-config ur env + helper-config.json (ADR 0029/0030).
 * Återanvänds av Electron-skalets "Logga in…"-meny som kör `runLogin` IN-PROCESS
 * (ingen child-process längre) och visar ett ev. fel i en dialog. `null` =
 * ingen server konfigurerad ännu.
 */
export function resolveLoginConfig(): LoginConfig | null {
  return loginConfigFromEnv(helperEnv());
}

async function handleLogin(): Promise<void> {
  const cfg = loginConfigFromEnv(helperEnv());
  if (!cfg) {
    process.stderr.write(
      "Ingen server konfigurerad. Sätt AVA_OIDC_ISSUER, eller skapa helper-config.json " +
        "(t.ex. {\"oidcIssuer\":\"http://localhost:8089/realms/ava\"}) i AVA:s data-katalog.\n",
    );
    process.exitCode = 1;
    return;
  }
  try {
    await runLogin(cfg);
    process.stdout.write("Inloggning klar — helpern är parad.\n");
  } catch (err) {
    process.stderr.write(`Inloggning misslyckades: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

/** Hantera engångs-CLI-flaggor; returnerar true om en flagga togs (main avslutar). */
function runCliFlag(argv: readonly string[]): boolean {
  if (argv.includes("--version")) { process.stdout.write(`${VERSION}\n`); return true; }
  if (argv.includes("--login")) { void handleLogin(); return true; }
  if (argv.includes("--install-trust")) { handleTrust("install"); return true; }
  if (argv.includes("--uninstall-trust")) { handleTrust("uninstall"); return true; }
  if (argv.includes("--install")) { handleInstall("install"); return true; }
  if (argv.includes("--uninstall")) { handleInstall("uninstall"); return true; }
  return false;
}

function main(): void {
  if (runCliFlag(process.argv)) return;

  initLog();
  const engine = startEngine();
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — avslutar`);
      engine.stop();
      process.exit(0);
    });
  }
}

// Bara när filen körs som entry (inte vid import från test/Electron-skal).
if (import.meta.main) main();
