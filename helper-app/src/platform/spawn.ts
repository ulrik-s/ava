/**
 * `spawnDetached` — starta ett OS-kommando utan att vänta på att det
 * avslutas (helpern returnerar så snart appen startat). Detached + unref
 * så processen inte hänger kvar som barn till helpern.
 *
 * Tunn wrapper kring `node:child_process` → injicerbar i test
 * (motsvarar Go:s `exec.Command(...).Start()`).
 */

import { spawn } from "node:child_process";

export interface SpawnResult {
  /** Resolvar när processen startat OK, rejectar vid spawn-fel (binär saknas). */
  started: Promise<void>;
}

export function spawnDetached(cmd: string, args: readonly string[]): SpawnResult {
  const child = spawn(cmd, [...args], { detached: true, stdio: "ignore" });
  const started = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    // `spawn` queuar 'spawn'-eventet när processen faktiskt startat.
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { started };
}
