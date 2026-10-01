/**
 * Porten demo-e2e:t serverar `out/` på (#1261).
 *
 * Förr var den fast (8799) och configen återanvände en server som redan körde
 * där. Parallella worktrees (agenter) testade då varandras byggen, eller fick
 * ECONNREFUSED när den andra körningen stängde sin server mitt i.
 *
 * Nu härleds porten ur worktreens sökväg: samma worktree får alltid samma port
 * (stabilt mellan körningar, och `_demo-test` räknar fram samma värde i
 * Playwright-arbetarna), olika worktrees hamnar på olika portar. `DEMO_PORT`
 * vinner om den är satt.
 */
import path from "node:path";

/** Första porten i intervallet worktree-portarna fördelas över. */
export const DEMO_PORT_MIN = 8800;
/** Antal portar i intervallet (8800–8999). */
export const DEMO_PORT_SPAN = 200;

/** Repo-roten för den här worktreen (filen ligger i `tooling/config/`). */
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/** FNV-1a (32 bit) — liten, deterministisk och jämnt spridd för sökvägar. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Worktreens port i 8800–8999, härledd ur dess rotsökväg. */
export function worktreePort(root: string): number {
  return DEMO_PORT_MIN + (fnv1a(root) % DEMO_PORT_SPAN);
}

/** `DEMO_PORT` om den är satt, annars worktreens egen port. */
export function demoPort(env: NodeJS.ProcessEnv = process.env, root: string = PROJECT_ROOT): number {
  const override = env.DEMO_PORT;
  if (!override) return worktreePort(root);
  const port = Number(override);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`DEMO_PORT måste vara en port (1–65535), fick "${override}"`);
  }
  return port;
}
