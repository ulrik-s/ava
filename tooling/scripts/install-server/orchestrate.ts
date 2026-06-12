/**
 * Orchestrering för install-server (#232) — bygg + starta + verifiera stacken
 * som ETT kommando. Ren, testbar logik: kommandosekvenserna (argv-listor) och
 * admin-token-extraktionen ur web-loggen. CLI:n kör dem via spawn (I/O).
 */

const DEMO_COMPOSE = "tooling/docker/docker-compose.yml";
const OIDC_OVERLAY = "tooling/docker/docker-compose.oidc.yml";
/** Web-containern printar `Admin-token:      <40 tecken>` EN gång vid bootstrap. */
const ADMIN_TOKEN_RE = /Admin-token:\s+([A-Za-z0-9]{40})/;
const WAIT_TIMEOUT_S = "180";

export interface StartOptions {
  /** OIDC-läge → starta även oauth2-proxy/Keycloak-overlayen. */
  oidc: boolean;
}

function composeArgs(oidc: boolean): string[] {
  const files = oidc ? [DEMO_COMPOSE, OIDC_OVERLAY] : [DEMO_COMPOSE];
  return ["docker", "compose", ...files.flatMap((f) => ["-f", f])];
}

/**
 * Kommandosekvens för att bygga static-export:en och starta stacken (väntar in
 * healthy via `--wait`). Returneras som argv-listor så CLI:n kan köra dem i
 * ordning; build-demo läser `DEMO_BASE_PATH` ur env (sätts av CLI:n).
 */
export function buildStartCommands(opts: StartOptions): string[][] {
  return [
    ["bash", "tooling/scripts/build-demo.sh"],
    [...composeArgs(opts.oidc), "up", "-d", "--build", "--wait", "--wait-timeout", WAIT_TIMEOUT_S],
  ];
}

/** Kommando för att läsa web-loggen (admin-token-extraktion). */
export function logsCommand(oidc: boolean): string[] {
  return [...composeArgs(oidc), "logs", "web"];
}

/** Avinstallation/nedrivning: stoppa stacken + ta bort volymer. */
export function buildStopCommands(opts: StartOptions): string[][] {
  return [[...composeArgs(opts.oidc), "down", "-v"]];
}

/** Plocka ut den bootstrappade admin-token:n ur web-loggen. null om ej funnen. */
export function extractAdminToken(logText: string): string | null {
  return logText.match(ADMIN_TOKEN_RE)?.[1] ?? null;
}
