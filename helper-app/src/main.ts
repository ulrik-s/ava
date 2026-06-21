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

import { ContentStore } from "./content-store.ts";
import { installService, uninstallService, type InstallDeps } from "./install.ts";
import { initLog, log } from "./log.ts";
import {
  defaultOpenDeps,
  defaultWatchDeps,
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

const SHUTDOWN_TIMEOUT_MS = 5_000;

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
function startHttpsServer(handler: Handler): ReturnType<typeof Bun.serve> | undefined {
  const dir = dataDir();
  if (dir === null) {
    log("ingen data-dir → hoppar över HTTPS (endast HTTP)");
    return undefined;
  }
  try {
    const tls = loadOrCreateTls(join(dir, "tls"));
    const server = Bun.serve({
      port: httpsPort(),
      hostname: "127.0.0.1",
      tls: { cert: tls.leaf.cert, key: tls.leaf.key },
      fetch: handler,
    });
    log(`ava-helper HTTPS på localhost:${httpsPort()}`);
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
export function queueBackedOnOpen(queue: UploadQueue, content: ContentStore): (req: Request) => Promise<Response> {
  const deps: OpenDeps = {
    ...defaultOpenDeps,
    startWatch: (path, uploadUrl, authHeader, timeoutMs) =>
      watchAndUpload(path, uploadUrl, authHeader, timeoutMs, {
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
function startStores(signal: AbortSignal): Stores | undefined {
  const dir = dataDir();
  if (dir === null) {
    log("ingen data-dir → durabla lager inaktiverade (direkt-upload, ingen offline-cache)");
    return undefined;
  }
  const queue = new UploadQueue(join(dir, "queue"));
  void queue.recover().then(() => queue.startDrainLoop(signal));
  const content = new ContentStore(join(dir, "content"));
  return { queue, content };
}

function main(): void {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (process.argv.includes("--install-trust")) {
    handleTrust("install");
    return;
  }
  if (process.argv.includes("--uninstall-trust")) {
    handleTrust("uninstall");
    return;
  }
  if (process.argv.includes("--install")) {
    handleInstall("install");
    return;
  }
  if (process.argv.includes("--uninstall")) {
    handleInstall("uninstall");
    return;
  }

  initLog();
  const port = listenPort();
  log(`ava-helper ${VERSION} startar på 127.0.0.1:${port}`);

  const updateCfg = buildUpdateConfig();
  const abort = new AbortController();
  void runUpdateLoop(updateCfg, abort.signal);

  const stores = startStores(abort.signal);
  const handler = createHandler({
    version: VERSION,
    extraOrigins: extraOrigins(),
    onCheckUpdate: () => { void checkOnce(updateCfg).catch((err) => log(`check-update: ${String(err)}`)); },
    ...(stores ? { onOpen: queueBackedOnOpen(stores.queue, stores.content), onStatus: () => stores.queue.snapshot() } : {}),
  });

  const httpServer = Bun.serve({ port, hostname: "127.0.0.1", fetch: handler });
  const httpsServer = startHttpsServer(handler);

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — avslutar`);
      abort.abort();
      void Promise.all([httpServer.stop(), httpsServer?.stop()]).then(() => process.exit(0));
      setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
    });
  }
}

main();
