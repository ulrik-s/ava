/**
 * Loggning till per-OS-fil. Tyst no-op vid fel — helpern ska aldrig
 * vägra starta pga loggproblem. (Port av Go:s openLogFile + log.Printf.)
 *
 *   - macOS:   ~/Library/Logs/AVA/helper.log
 *   - Windows: %LOCALAPPDATA%\AVA\Logs\helper.log
 *   - Linux:   ~/.local/state/AVA/helper.log
 */

import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { currentPlatform } from "./platform/runtime.ts";

function logDir(): string | null {
  const home = homedir();
  if (home === "") return null;
  switch (currentPlatform()) {
    case "darwin":
      return join(home, "Library", "Logs", "AVA");
    case "windows":
      return join(process.env.LOCALAPPDATA ?? home, "AVA", "Logs");
    default:
      return join(home, ".local", "state", "AVA");
  }
}

let logFilePath: string | null = null;

/** Initiera loggfilen. Returnerar sökvägen, eller null om det inte gick. */
export function initLog(): string | null {
  const dir = logDir();
  if (dir === null) return null;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "helper.log");
    openSync(path, "a", 0o600); // skapa filen om den saknas
    logFilePath = path;
    return path;
  } catch {
    return null;
  }
}

/** Logga en rad till fil (om initierad) + stderr, med ISO-tidsstämpel. */
export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (logFilePath !== null) {
    try {
      appendFileSync(logFilePath, line);
    } catch {
      /* tyst — loggfel får aldrig krascha helpern */
    }
  }
  process.stderr.write(line);
}
