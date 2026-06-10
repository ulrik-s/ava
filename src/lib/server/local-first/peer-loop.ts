/**
 * Server-runtime D (#118, ADR 0005 fas 1) — peer-loopen.
 *
 * `PeerLoop` är den periodiska drivaren ovanpå primitiven i #117
 * (`runPeerCycle`). Den speglar `SyncLoop`-designen (local-first-klienten):
 * loopen vet bara HUR ofta den ska ticka — vad som händer per tick är
 * injicerat.
 *
 * Två lägen per tick:
 *   - **cykel** (när ett `job` är satt): kör en konflikt-säker
 *     pull→act→push-cykel via `runPeerCycle`. Det är hit framtida connectorer
 *     (#80 regler/schemaläggare, #82 Fortnox) kopplar in sina mutationer.
 *   - **sync** (när inget `job` finns ännu): håll bara working-copy:n à jour
 *     med remote (fetch + reset). Ingen push → inga tomma commits. Servern är
 *     en nyttig, à-jour git-peer redan innan första connectorn finns.
 *
 * Felhantering (som `SyncLoop`): en krasch i en tick loggas men tar inte ner
 * loopen — nästa tick försöker igen.
 */

import { NodeGitOps } from "./node-git-ops";
import {
  runPeerCycle,
  type PeerAct,
  type PeerCycleResult,
  type RunPeerCycleOpts,
} from "./server-peer";

const DEFAULT_INTERVAL_MS = 15_000;

/** En mutation att köra per tick (connector-arbetet). */
export interface PeerJob {
  act: PeerAct;
  message: string;
}

export type RunCycle = (
  dir: string,
  act: PeerAct,
  message: string,
  opts: RunPeerCycleOpts,
) => Promise<PeerCycleResult>;

export type SyncOnce = (dir: string, opts: RunPeerCycleOpts) => Promise<void>;

export interface PeerLoopDeps {
  /** Working-copy-katalogen peern arbetar i. */
  dir: string;
  /** Vidarebefordras till `runPeerCycle`/sync (principal, branch, remote, maxRetries). */
  cycleOpts: RunPeerCycleOpts;
  /** Polling-intervall i ms. Default 15s. */
  intervalMs?: number;
  /** Sätts → cykel-läge; utelämnas → sync-läge. */
  job?: PeerJob;
  log?: (msg: string) => void;
  /** Injicerbara seams för test. */
  runCycle?: RunCycle;
  syncOnce?: SyncOnce;
}

export type PeerLoopTick =
  | { mode: "cycle"; result: PeerCycleResult }
  | { mode: "sync" }
  | { mode: "error"; error: unknown };

/** Standard sync-tick: fetch + hård reset till remote. Ingen push. */
async function defaultSyncOnce(dir: string, opts: RunPeerCycleOpts): Promise<void> {
  const author = opts.author ?? { name: opts.principal.name, email: opts.principal.email };
  const git = new NodeGitOps(dir, author.name, author.email, opts.remote ?? "origin", opts.branch ?? "main");
  await git.fetch();
  await git.resetHardToRemote();
}

export class PeerLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly log: (msg: string) => void;
  private readonly runCycle: RunCycle;
  private readonly syncOnce: SyncOnce;

  constructor(private readonly deps: PeerLoopDeps) {
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.log = deps.log ?? ((msg) => console.log(`[server-runtime] ${msg}`));
    this.runCycle = deps.runCycle ?? runPeerCycle;
    this.syncOnce = deps.syncOnce ?? defaultSyncOnce;
  }

  /** Starta polling. Idempotent — andra anrop är no-op om redan startad. */
  start(): void {
    if (this.timer) return;
    this.log(`peer-loop startar (intervall ${this.intervalMs} ms, läge ${this.deps.job ? "cykel" : "sync"})`);
    this.timer = setInterval(() => {
      void this.tickOnce().catch((err) => this.log(`tick kastade: ${String(err)}`));
    }, this.intervalMs);
  }

  /** Stoppa polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * En explicit tick. Exponerad så tester kan driva loopen deterministiskt
   * utan fake timers, och så entryn kan köra en enda cykel (`--once`).
   */
  async tickOnce(): Promise<PeerLoopTick> {
    const { job, dir, cycleOpts } = this.deps;
    try {
      if (job) {
        const result = await this.runCycle(dir, job.act, job.message, cycleOpts);
        this.log(result.pushed ? `pushade (${result.attempts} försök)` : `push misslyckades: ${result.reason ?? "okänt"}`);
        return { mode: "cycle", result };
      }
      await this.syncOnce(dir, cycleOpts);
      return { mode: "sync" };
    } catch (error) {
      this.log(`tick-fel: ${String(error)}`);
      return { mode: "error", error };
    }
  }
}
