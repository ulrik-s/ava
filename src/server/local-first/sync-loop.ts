/**
 * `SyncLoop` — bakgrundsprocess som driver fetch + hydrate i
 * local-first-läget.
 *
 * Designprincip (Single responsibility):
 *   - Loopen vet bara HUR ofta att synca (intervallet). Den vet inget
 *     om Prisma, Yjs eller Tauri-events.
 *   - Hydrate-callback:n (`onHydrated`) tar emot (entity, data, path)
 *     och callern (typiskt Tauri-runtime) översätter till SQLite-upsert.
 *
 * Designval (Dependency inversion):
 *   - Beror på `IGitOps` + `ProjectionHydrator`-interfaces.
 *     Tester injicerar in-memory-impl + spy:are på callback.
 *
 * Konservativ regel: om klienten har lokala commits ahead av remote
 * skippar vi tick:en. Vi vill aldrig riskera att förlora lokala writes
 * via en automatisk reset. Användaren får synkronisera/pusha först.
 *
 * Felhantering: en krasch i hydrate-callback eller fetch loggas men
 * tar inte ner loopen. Nästa tick försöker igen.
 */

import type { IGitOps } from "./git-ops";
import type {
  ProjectionHydrator,
  HydrateCallback,
} from "./projection-writer";

export interface SyncLoopDeps {
  git: IGitOps;
  hydrator: ProjectionHydrator;
  onHydrated: HydrateCallback;
  /** Polling-intervall i ms. Default 15s — se `architecture-future.md` §3.5. */
  intervalMs?: number;
}

export interface TickResult {
  hadChanges: boolean;
  changedPaths: string[];
  hydrated: number;
  skippedReason?: "local-ahead" | "fetch-error" | "hydrate-error";
}

export class SyncLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeenRemoteHash: string | null = null;
  private readonly intervalMs: number;

  constructor(private deps: SyncLoopDeps) {
    this.intervalMs = deps.intervalMs ?? 15_000;
  }

  /** Starta polling. Idempotent — andra anrop är no-op om redan startad. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tickOnce().catch((err) => {
        console.error("[sync-loop] tick kastade:", err);
      });
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
   * En explicit polling-cykel. Exponerad så tester kan driva loopen
   * deterministiskt utan fake timers, OCH så att tRPC-router kan trigga
   * en sync manuellt vid behov (t.ex. "Pull"-knapp i UI:t).
   */
  async tickOnce(): Promise<TickResult> {
    // Konservativt skydd: skippa om lokala commits finns ahead.
    const pending = await this.deps.git.pendingCommitsAhead();
    if (pending.length > 0) {
      return { hadChanges: false, changedPaths: [], hydrated: 0, skippedReason: "local-ahead" };
    }

    try {
      await this.deps.git.fetch();
    } catch {
      return { hadChanges: false, changedPaths: [], hydrated: 0, skippedReason: "fetch-error" };
    }

    const currentRemote = await this.deps.git.remoteHead();
    const knownHash = this.lastSeenRemoteHash ?? (await this.deps.git.localHead()).hash;

    if (currentRemote.hash === knownHash) {
      this.lastSeenRemoteHash = currentRemote.hash;
      return { hadChanges: false, changedPaths: [], hydrated: 0 };
    }

    const changedPaths = await this.deps.git.changedFiles(knownHash, currentRemote.hash);
    await this.deps.git.resetHardToRemote();

    let hydrated = 0;
    try {
      hydrated = await this.deps.hydrator.hydrateChanges(
        changedPaths,
        this.deps.onHydrated,
      );
    } catch (err) {
      console.error("[sync-loop] hydrate kraschade:", err);
      // Vi har redan reset:at — låt nästa tick försöka igen på samma paths
      return { hadChanges: true, changedPaths, hydrated, skippedReason: "hydrate-error" };
    }

    this.lastSeenRemoteHash = currentRemote.hash;
    return { hadChanges: true, changedPaths, hydrated };
  }
}
