/**
 * "Uppdatera nu" i statusfönstret: kör samma installationsskript som
 * Terminal-kommandot (public/helper/install.sh, inbakat vid build). Hämtat med
 * curl får appen ingen karantän-markering, så det osignerade bygget startar.
 * Skriptet avslutar den körande appen och startar den nya — därför körs det
 * frikopplat (`detached`) och överlever att appen stängs.
 */

import { spawn, type SpawnOptions } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

declare const __AVA_INSTALL_SCRIPT__: string | undefined;

/** Skriptet, eller null i dev (`bun src/main.ts`) där det inte bakats in. */
export const INSTALL_SCRIPT: string | null =
  typeof __AVA_INSTALL_SCRIPT__ !== "undefined" ? __AVA_INSTALL_SCRIPT__ : null;

/** Det lilla av en child-process som behövs → testbart utan att köra bash. */
export interface InstallerChild {
  stdin: { end: (data: string) => void } | null;
  unref: () => void;
}
export type SpawnFn = (cmd: string, args: readonly string[], opts: SpawnOptions) => InstallerChild;

/** Starta skriptet frikopplat; utdata hamnar i `logFile` (felsökning). */
export function runInstaller(script: string, logFile: string, spawnFn: SpawnFn = spawn): void {
  mkdirSync(dirname(logFile), { recursive: true });
  const out = openSync(logFile, "a");
  const child = spawnFn("/bin/bash", ["-s"], { detached: true, stdio: ["pipe", out, out] });
  child.stdin?.end(script);
  child.unref();
}
