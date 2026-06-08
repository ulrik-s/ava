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

import { join } from "node:path";

import { HELPER_HTTPS_PORT, HELPER_PORT } from "@/lib/shared/helper/protocol";

import { dataDir } from "./paths.ts";
import { initLog, log } from "./log.ts";
import { createHandler } from "./server.ts";
import { loadOrCreateTls } from "./tls/certs.ts";
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

function main(): void {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  initLog();
  const port = listenPort();
  log(`ava-helper ${VERSION} startar på 127.0.0.1:${port}`);

  const updateCfg = buildUpdateConfig();
  const abort = new AbortController();
  void runUpdateLoop(updateCfg, abort.signal);

  const handler = createHandler({
    version: VERSION,
    extraOrigins: extraOrigins(),
    onCheckUpdate: () => { void checkOnce(updateCfg).catch((err) => log(`check-update: ${String(err)}`)); },
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
