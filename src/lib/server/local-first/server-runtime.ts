/**
 * Server-runtime D (#118, ADR 0005 fas 1) — composition root.
 *
 * Knyter ihop config (#118), klon-primitiven (#117) och peer-loopen till en
 * startbar runtime. `startServerRuntime` är den enda funktion den körbara
 * entryn (`src/bin/server-runtime.ts`) behöver — den är dessutom
 * dependency-injection-bar så tester kan köra den utan riktig git.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";

import { cloneWorkingCopy, type CloneWorkingCopyOpts } from "./server-peer";
import { PeerLoop, type PeerJob, type PeerLoopDeps } from "./peer-loop";
import type { RuntimeConfig } from "./server-runtime-config";

export interface StartServerRuntimeDeps {
  /** Klon-funktion (default: `cloneWorkingCopy`). */
  clone?: (opts: CloneWorkingCopyOpts) => Promise<void>;
  /** Avgör om `dir` redan är en git-working-copy (default: kollar `.git`). */
  isGitRepo?: (dir: string) => Promise<boolean>;
  /** Connector-mutationen per tick. Utelämnas → loopen kör i sync-läge. */
  job?: PeerJob;
  log?: (msg: string) => void;
  /**
   * Delat lås runt varje tick (#83, ADR 0013 beslut A). Entryn skapar EN
   * Mutex och delar den mellan peer-loopen och HTTP-API:t så de aldrig skriver
   * working-copy:n samtidigt. Utelämnas → ingen serialisering (default).
   */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

async function defaultIsGitRepo(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Bygg PeerLoop-deps ur config + valfria seams (utan att skicka undefined). */
function buildLoopDeps(config: RuntimeConfig, deps: StartServerRuntimeDeps): PeerLoopDeps {
  return {
    dir: config.workDir,
    cycleOpts: {
      principal: config.principal,
      branch: config.branch,
      remote: config.remote,
      maxRetries: config.maxRetries,
    },
    intervalMs: config.pollIntervalMs,
    ...(deps.job ? { job: deps.job } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.lock ? { lock: deps.lock } : {}),
  };
}

/**
 * Starta server-runtimen: klona `firma.git` om working-copy:n saknas (annars
 * återanvänd den befintliga), och starta peer-loopen. Returnerar loopen så
 * caller kan `stop()`:a den (signal-hantering, `--once`, test).
 */
export async function startServerRuntime(
  config: RuntimeConfig,
  deps: StartServerRuntimeDeps = {},
): Promise<PeerLoop> {
  const clone = deps.clone ?? cloneWorkingCopy;
  const isGitRepo = deps.isGitRepo ?? defaultIsGitRepo;
  const log = deps.log ?? ((msg) => console.log(`[server-runtime] ${msg}`));

  if (await isGitRepo(config.workDir)) {
    log(`återanvänder working-copy: ${config.workDir}`);
  } else {
    log(`klonar ${config.repoUrl} → ${config.workDir} (branch ${config.branch})`);
    await clone({ url: config.repoUrl, dir: config.workDir, branch: config.branch });
  }

  const loop = new PeerLoop(buildLoopDeps(config, deps));
  loop.start();
  return loop;
}
