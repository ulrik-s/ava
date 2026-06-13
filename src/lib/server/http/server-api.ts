/**
 * `server-api` — composition-root för server-runtime:ns tRPC-over-HTTP-API
 * (#83 steg 1c, ADR 0013). Knyter ihop bitarna från steg 1/1b till EN
 * fetch-handler:
 *
 *   PAT-verifierare (config-tokens → principal)         [steg 1]
 *   + per-request working-copy-session (sync/commit/push) [steg 1b]
 *   + delat lås mot peer-loopen                           [beslut A]
 *   → `createTrpcHttpHandler`                             [steg 1]
 *
 * Alla tokens mappar till runtime:ns `principal` (maskin-principal-vägen, ADR
 * 0009); per-användar-PAT:er (token → specifik user-principal) är en framtida
 * uppgradering. Detta håller #83-MVP:n enkel: en byrå-server, en principal.
 */

import { createTrpcHttpHandler } from "./trpc-http-handler";
import { makeWorkingCopySessionOpener } from "./working-copy-session";
import { StaticPatVerifier, patRecord } from "./pat";
import type { Principal } from "@/lib/server/auth/principal";

export interface ServerApiConfig {
  /** Working-copy-katalogen (delas med peer-loopen). */
  workDir: string;
  /** Remote/branch för sync + push. */
  remote: string;
  branch: string;
  /** Bearer-PAT:er som auktoriserar mot API:t. */
  apiTokens: readonly string[];
  /** Principalen alla tokens auktoriserar som (maskin-principal). */
  principal: Principal;
}

export interface ServerApiDeps {
  /** Delat lås mot peer-loopen (ADR 0013 beslut A). */
  lock: <T>(fn: () => Promise<T>) => Promise<T>;
  log?: (msg: string) => void;
}

/**
 * Bygg fetch-handlern för server-runtime:ns HTTP-API. Returnerar `null` om
 * inga tokens är konfigurerade (då monteras inget API — ren git-peer).
 */
export function buildServerApiHandler(
  config: ServerApiConfig,
  deps: ServerApiDeps,
): ((req: Request) => Promise<Response>) | null {
  if (config.apiTokens.length === 0) return null;

  const verifier = new StaticPatVerifier(
    config.apiTokens.map((token) => patRecord(token, config.principal)),
  );
  const openSession = makeWorkingCopySessionOpener({
    dir: config.workDir,
    remote: config.remote,
    branch: config.branch,
  });
  const log = deps.log ?? (() => {});
  return createTrpcHttpHandler({
    verifier,
    openSession,
    lock: deps.lock,
    onError: (err) => log(`[api] router-fel: ${String(err)}`),
  });
}
