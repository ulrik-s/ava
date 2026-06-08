/**
 * `openWithDefaultApp` — starta OS:ets default-app för en fil. Helpern
 * väntar INTE på att appen ska stänga; den returnerar så snart appen
 * startat. (Port av Go:s platform.OpenWithDefaultApp.)
 *
 * `openCommand` (ren) bygger kommandot per plattform → testbar utan spawn
 * (SOLID: separera "vilket kommando" från "kör det").
 */

import type { Command } from "./command.ts";
import { currentPlatform, type Platform } from "./runtime.ts";
import { spawnDetached } from "./spawn.ts";

export function openCommand(platform: Platform, path: string): Command {
  switch (platform) {
    case "darwin":
      return { cmd: "open", args: [path] };
    case "linux":
      return { cmd: "xdg-open", args: [path] };
    case "windows":
      // rundll32 url.dll,FileProtocolHandler triggar default-app utan
      // att öppna ett konsolfönster.
      return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", path] };
    default:
      throw new Error(`unsupported OS: ${platform}`);
  }
}

export async function openWithDefaultApp(path: string): Promise<void> {
  const { cmd, args } = openCommand(currentPlatform(), path);
  await spawnDetached(cmd, args).started;
}
