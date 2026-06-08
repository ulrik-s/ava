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

import { HELPER_PORT } from "@/lib/shared/helper/protocol";

import { initLog, log } from "./log.ts";
import { createHandler } from "./server.ts";
import { checkOnce, runUpdateLoop, type UpdateConfig } from "./update.ts";
import { VERSION } from "./version.ts";

const SHUTDOWN_TIMEOUT_MS = 5_000;

function extraOrigins(): string[] {
  return (process.env.AVA_HELPER_ORIGINS ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
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
  log(`ava-helper ${VERSION} startar på 127.0.0.1:${HELPER_PORT}`);

  const updateCfg = buildUpdateConfig();
  const abort = new AbortController();
  void runUpdateLoop(updateCfg, abort.signal);

  const server = Bun.serve({
    port: HELPER_PORT,
    hostname: "127.0.0.1",
    fetch: createHandler({
      version: VERSION,
      extraOrigins: extraOrigins(),
      onCheckUpdate: () => { void checkOnce(updateCfg).catch((err) => log(`check-update: ${String(err)}`)); },
    }),
  });

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`${sig} — avslutar`);
      abort.abort();
      void server.stop().then(() => process.exit(0));
      setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
    });
  }
}

main();
