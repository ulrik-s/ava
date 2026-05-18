/**
 * `LocalRuntime` — composition root för local-first-läget.
 *
 * Binder ihop alla local-first-komponenter (filsystem, git, prisma,
 * projection-system, sync-loop, claim-store, event-log) till ett
 * lättanvänt API som Tauri-appens entry-point konsumerar.
 *
 * Designval (Single responsibility):
 *   - Wire-up bara. Klassen har ingen domain-logik.
 *
 * Designval (Dependency inversion):
 *   - `LocalRuntime.create({ fs, git, prisma, me })` tar in alla
 *     beroenden så Tauri-runtime kan injicera NodeFileSystem +
 *     NodeGitOps + riktig Prisma-mot-SQLite, medan tester injicerar
 *     in-memory-impl.
 *
 * Designval (lifecycle):
 *   - `startSync()` startar polling-loopen (separat från konstruktion
 *     så den inte kör i tester som inte vill ha bakgrunds-fetch).
 *   - `shutdown()` är idempotent och blockerar tills allt stängts ner
 *     ordentligt.
 */

import type { PrismaClient } from "@prisma/client";
import type { IDataStore } from "../data-store/IDataStore";
import type { IFileSystem } from "./file-system";
import type { IGitOps } from "./git-ops";
import { LocalGitStore } from "./local-git-store";
import { ProjectionHydrator } from "./projection-writer";
import { buildDefaultRegistry } from "./projections/default-registry";
import type { ProjectionRegistry } from "./projections/registry";
import { SyncLoop } from "./sync-loop";

export interface LocalRuntimeDeps {
  fs: IFileSystem;
  git: IGitOps;
  prisma: PrismaClient;
  /** User-id för commit-author + claim-owner. */
  me: string;
  /** Default = `buildDefaultRegistry()`. Tester kan injicera tomma. */
  registry?: ProjectionRegistry;
  /** Default = 15 sek. */
  syncIntervalMs?: number;
  /**
   * Callback som anropas för varje hydratiserad entitet under sync.
   * Tauri-runtime mappar typiskt detta till en SQLite-upsert via
   * `dataStore.<entity>.upsert(...)` så cachet håller takt med git.
   */
  onHydrated?: (entity: string, data: unknown, path: string) => void | Promise<void>;
}

export class LocalRuntime {
  public readonly dataStore: IDataStore;
  public readonly syncLoop: SyncLoop;
  public readonly me: string;
  private readonly prisma: PrismaClient;
  private readonly store: LocalGitStore;
  private isShutdown = false;

  private constructor(deps: LocalRuntimeDeps) {
    this.me = deps.me;
    this.prisma = deps.prisma;
    const registry = deps.registry ?? buildDefaultRegistry();
    this.store = new LocalGitStore({
      fs: deps.fs, git: deps.git, me: deps.me, prisma: deps.prisma, registry,
    });
    this.dataStore = this.store;
    const hydrator = new ProjectionHydrator(deps.fs, registry);
    this.syncLoop = new SyncLoop({
      git: deps.git,
      hydrator,
      onHydrated: deps.onHydrated ?? (() => {}),
      intervalMs: deps.syncIntervalMs,
    });
  }

  /** Fabriksfunktion — håller constructor:n privat så vi kan validera. */
  static create(deps: LocalRuntimeDeps): LocalRuntime {
    return new LocalRuntime(deps);
  }

  /** Starta bakgrunds-syncen. Idempotent. */
  startSync(): void {
    if (this.isShutdown) return;
    this.syncLoop.start();
  }

  /** Stäng allt och disconnecta Prisma. Idempotent. */
  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;
    this.syncLoop.stop();
    this.store.detachProjection();
    await this.prisma.$disconnect();
  }
}
