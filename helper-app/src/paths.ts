/**
 * Per-OS data-katalog (skild från loggkatalogen). Här lagras TLS-material
 * (lokal CA + leaf, #102). Ren `resolveDataDir` → testbar utan env/fs.
 *
 *   - macOS:   ~/Library/Application Support/AVA
 *   - Windows: %LOCALAPPDATA%\AVA
 *   - Linux:   $XDG_DATA_HOME/AVA  (annars ~/.local/share/AVA)
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { currentPlatform, type Platform } from "./platform/runtime.ts";

export interface DataDirEnv {
  localAppData?: string | undefined;
  xdgDataHome?: string | undefined;
}

export function resolveDataDir(platform: Platform, home: string, env: DataDirEnv = {}): string | null {
  if (home === "") return null;
  switch (platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "AVA");
    case "windows":
      return join(env.localAppData ?? home, "AVA");
    default:
      return join(env.xdgDataHome && env.xdgDataHome !== "" ? env.xdgDataHome : join(home, ".local", "share"), "AVA");
  }
}

export function dataDir(): string | null {
  return resolveDataDir(currentPlatform(), homedir(), {
    localAppData: process.env.LOCALAPPDATA,
    xdgDataHome: process.env.XDG_DATA_HOME,
  });
}
