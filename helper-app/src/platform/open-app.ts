/**
 * `openWithDefaultApp` — starta OS:ets default-app för en fil. Helpern
 * väntar INTE på att appen ska stänga; den returnerar så snart appen
 * startat. (Port av Go:s platform.OpenWithDefaultApp.)
 */

import { currentPlatform } from "./runtime.ts";
import { spawnDetached } from "./spawn.ts";

export async function openWithDefaultApp(path: string): Promise<void> {
  switch (currentPlatform()) {
    case "darwin":
      await spawnDetached("open", [path]).started;
      return;
    case "linux":
      await spawnDetached("xdg-open", [path]).started;
      return;
    case "windows":
      // rundll32 url.dll,FileProtocolHandler triggar default-app utan
      // att öppna ett konsolfönster.
      await spawnDetached("rundll32", ["url.dll,FileProtocolHandler", path]).started;
      return;
    default:
      throw new Error(`unsupported OS: ${process.platform}`);
  }
}
