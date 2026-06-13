/**
 * `working-copy-session` — composition mellan HTTP-handlern (#83) och
 * server-runtime:ns git-working-copy (ADR 0005). Implementerar `openSession`
 * för {@link createTrpcHttpHandler} enligt concurrency-beslut A (ADR 0013):
 *
 *   per request (inuti det delade låset):
 *     1. `sync`   — fetch + hård reset till remote (var à jour med peers)
 *     2. `open`   — hydrera entiteter → DemoDataStore → Context
 *     3. servera  — handlern kör routern mot contexten
 *     4. finalize — BARA för mutationer (POST): commit + push om det blev en
 *                   faktisk ändring (`hasChanges`), annars no-op (inga tomma
 *                   commits, ingen onödig push på queries).
 *
 * Allt I/O (sync/open) injiceras så enheten är testbar utan riktig git.
 */

import { openServerWorkingCopy, type ServerWorkingCopy } from "@/lib/server/local-first/server-working-copy";
import { NodeGitOps } from "@/lib/server/local-first/node-git-ops";
import type { Principal } from "@/lib/server/auth/principal";
import type { RequestSession } from "./trpc-http-handler";

/** tRPC över HTTP: GET = query, POST = mutation (httpBatchLink-konventionen). */
function isMutation(req: Request): boolean {
  return req.method === "POST";
}

export interface WorkingCopySessionDeps {
  /** Working-copy-katalogen (server-runtime:ns `firma.git`-klon). */
  dir: string;
  /** Remote/branch för sync + push. Default origin/main. */
  remote?: string;
  branch?: string;
  /** Hydrera working-copy:n (default {@link openServerWorkingCopy}). */
  open?: (dir: string, principal: Principal) => Promise<ServerWorkingCopy>;
  /** Var à jour med remote före hydrering (default: fetch + reset --hard). */
  sync?: (dir: string, principal: Principal) => Promise<void>;
  /** Commit-meddelande för en add-in-mutation. */
  commitMessage?: (principal: Principal) => string;
}

/** Default-sync: fetch + hård reset till remote (speglar peer-loopens sync-tick). */
async function defaultSync(
  dir: string, principal: Principal, remote: string, branch: string,
): Promise<void> {
  const git = new NodeGitOps(dir, principal.name, principal.email, remote, branch);
  await git.fetch();
  await git.resetHardToRemote();
}

/**
 * Bygg en `openSession(principal)` för {@link createTrpcHttpHandler}. Anropas
 * inuti handlerns delade lås, så sync/hydrera/commit/push aldrig krockar med
 * peer-loopen (ADR 0013, beslut A).
 */
export function makeWorkingCopySessionOpener(
  deps: WorkingCopySessionDeps,
): (principal: Principal) => Promise<RequestSession> {
  const remote = deps.remote ?? "origin";
  const branch = deps.branch ?? "main";
  const open = deps.open ?? ((dir, principal) => openServerWorkingCopy(dir, { principal, remote, branch }));
  const sync = deps.sync ?? ((dir, principal) => defaultSync(dir, principal, remote, branch));
  const commitMessage = deps.commitMessage ?? ((p) => `ava: add-in-mutation (${p.email})`);

  return async (principal: Principal): Promise<RequestSession> => {
    await sync(deps.dir, principal);
    const wc = await open(deps.dir, principal);
    return {
      context: wc.context,
      finalize: async (req: Request) => {
        if (!isMutation(req)) return;
        if (!(await wc.gitOps.hasChanges())) return;
        await wc.commit(commitMessage(principal));
        await wc.gitOps.push();
      },
    };
  };
}
