/**
 * Server-runtime C (#117, ADR 0005 fas 1) — git-peer-loopen.
 *
 * Servern är en git-PEER, inte en dataägare: den klonar `firma.git`, kör
 * mutationer mot sin egen working copy och pushar tillbaka. Detta är
 * komplementet till läs-vägen (#115) + skriv-vägen (#116) och uppfyller
 * #77:s "Klar när".
 *
 * Konflikt-säkerhet (ADR 0002): pushen är CAS (`NodeGitOps.push` returnerar
 * `NonFastForward` om remote drivit fram). Vid konflikt synkar vi till
 * remote, RE-hydrerar och kör `act` igen ovanpå senaste remote-state. Eftersom
 * skrivningarna är nyckel-baserade (samma entitets-id → samma fil, overwrite)
 * är en omkörning idempotent — inga dubbletter, ingen clobber av andras rader.
 *
 * Native git (subprocess) snarare än isomorphic-git: git-creds tas via
 * systemets git-config/credential-helper (SSH-agent, HTTPS-helper), precis
 * som `NodeGitOps` redan förutsätter.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { NodeGitOps } from "./node-git-ops";
import type { GitCommit, PushResult } from "./git-ops";
import {
  openServerWorkingCopy,
  type OpenServerWorkingCopyOpts,
  type ServerWorkingCopy,
} from "./server-working-copy";

const execFileP = promisify(execFile);

export interface CloneWorkingCopyOpts {
  /** Remote-url till firma.git (file://, https:// eller ssh). */
  url: string;
  /** Mål-katalog för working-copy:n (måste vara tom/ej existerande). */
  dir: string;
  /** Branch att checka ut. Default: remote-default (oftast main). */
  branch?: string;
}

/**
 * Klona `firma.git` till `dir` via system-git. Git-creds hanteras av
 * systemets git-config/credential-helper — vi skickar inga hemligheter här.
 */
export async function cloneWorkingCopy(opts: CloneWorkingCopyOpts): Promise<void> {
  const args = ["clone", "--quiet"];
  if (opts.branch) args.push("--branch", opts.branch);
  args.push(opts.url, opts.dir);
  await execFileP("git", args);
}

/** En körbar mutation mot peer-clonens tRPC-caller. */
export type PeerAct = (caller: ServerWorkingCopy["caller"]) => Promise<void>;

export interface RunPeerCycleOpts extends OpenServerWorkingCopyOpts {
  /** Max antal försök vid push-konflikt (NonFastForward). Default 3. */
  maxRetries?: number;
}

export interface PeerCycleResult {
  /** Lyckades pushen (ev. efter retries)? */
  pushed: boolean;
  /** Antal försök som kördes. */
  attempts: number;
  /** Commit:en som pushades (när `pushed`). */
  commit?: GitCommit;
  /** Anledning vid misslyckande (sista pushens reason). */
  reason?: PushResult["reason"];
  /** `act` producerade inga ändringar → ingen commit/push gjordes (#80). */
  noop?: boolean;
}

/**
 * Kör en konflikt-säker pull → act → push-cykel mot working-copy:n på `dir`.
 *
 * Per försök:
 *   1. `fetch` + `resetHardToRemote` — börja från senaste remote (kastar en
 *      ev. misslyckad lokal commit från föregående försök).
 *   2. öppna en FÄRSK `ServerWorkingCopy` (hydrerar ovanpå remote-state).
 *   3. kör `act(caller)` → write-back skriver filer → `commit(message)`.
 *   4. `push`. Lyckas → klart. `NonFastForward` → nytt försök. Annat
 *      (nätverk/okänt) → avbryt.
 *
 * `act` MÅSTE vara idempotent/additiv (nyckla mot entitets-id) så en omkörning
 * efter konflikt inte dubblerar — det är konflikt-säkerheten (ADR 0002).
 */
/** Bygg NodeGitOps ur opts (författare/remote/branch-defaults). */
function gitOpsFor(dir: string, opts: RunPeerCycleOpts): NodeGitOps {
  const author = opts.author ?? { name: opts.principal.name, email: opts.principal.email };
  return new NodeGitOps(dir, author.name, author.email, opts.remote ?? "origin", opts.branch ?? "main");
}

export async function runPeerCycle(
  dir: string,
  act: PeerAct,
  message: string,
  opts: RunPeerCycleOpts,
): Promise<PeerCycleResult> {
  const maxRetries = opts.maxRetries ?? 3;
  const gitOps = gitOpsFor(dir, opts);

  let reason: PushResult["reason"];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Synka till remote innan vi agerar (CAS-startpunkt).
    await gitOps.fetch();
    await gitOps.resetHardToRemote();

    // Färsk hydrering ovanpå senaste remote → act → commit.
    const wc = await openServerWorkingCopy(dir, opts);
    await act(wc.caller);

    // Inga ändringar (t.ex. en alltid-på regelmotor utan nya påminnelser) →
    // hoppa över commit + push så vi inte spammar tomma commits varje tick (#80).
    if (!(await gitOps.hasChanges())) {
      return { pushed: false, attempts: attempt, noop: true };
    }
    const commit = await wc.commit(message);

    const result = await gitOps.push();
    if (result.ok) return { pushed: true, attempts: attempt, commit };

    reason = result.reason;
    // Bara NonFastForward är värt att försöka igen; nätverk/okänt avbryter.
    if (result.reason !== "NonFastForward") break;
  }
  return { pushed: false, attempts: maxRetries, reason };
}
