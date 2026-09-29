/**
 * `SyncScheduler` — får lokala ändringar till servern DIREKT (dataförlust 2026-09-23).
 *
 * Server-first-klienten reconcile:ade bara vid sidladdning: det man gjorde under
 * dagen låg enbart i webbläsaren tills nästa laddning, och försvann om fliken
 * kraschade eller webbläsardatan rensades innan dess. Schemaläggaren kör en
 * reconcile strax efter varje ändring (debounce — flera sparningar i rad blir en
 * synk), periodiskt (fångar andras ändringar + retry efter fel) och när nätet
 * kommer tillbaka.
 *
 * Aldrig två reconcile samtidigt: en ändring under pågående synk ger en ny
 * runda efteråt, så inget blir liggande. Ren klass — timers injiceras (test).
 */

import { isUnauthorizedError } from "../auth/unauthorized";
import type { CachingSyncStatus } from "./caching-sync-status";

export interface ReconcileOutcome {
  pulled: number;
  /** Rader ur serverns svar på omkörda procedur-anrop (#1265). */
  replayed?: number;
}

export interface SyncSchedulerDeps {
  reconcile: () => Promise<ReconcileOutcome>;
  pendingCount: () => number;
  isOnline: () => boolean;
  onStatus: (status: CachingSyncStatus) => void;
  /** Lokalt läge ändrat av servern (pull eller omkörda anrop) → UI:t hämtar om sina frågor. */
  onRemoteChanges?: () => void;
  /**
   * Servern svarade 401 (#1245): sessionen gick ut eller kontot är spärrat.
   * Returnerar beskedet att visa i stället för det generiska felet.
   */
  onUnauthorized?: () => Promise<string | null>;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

const DEFAULT_DEBOUNCE_MS = 800;

function saveErrorMessage(err: unknown): string {
  return `Kunde inte spara till servern: ${err instanceof Error ? err.message : String(err)}`;
}

export class SyncScheduler {
  private timer: unknown = null;
  private running = false;
  private rerun = false;
  private lastSyncedAt: number | null = null;
  private error: string | null = null;

  constructor(private readonly deps: SyncSchedulerDeps) {}

  /** En lokal ändring har sparats — synka strax (debouncat). */
  notifyChange(): void {
    this.publish();
    const setTimer = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    if (this.timer !== null) clearTimer(this.timer);
    this.timer = setTimer(() => { this.timer = null; void this.syncNow(); }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Synka nu. Pågår redan en synk → en ny runda körs direkt efteråt. */
  async syncNow(): Promise<void> {
    if (this.running) { this.rerun = true; return; }
    if (!this.deps.isOnline()) { this.publish(); return; }
    this.running = true;
    this.publish();
    try {
      await this.runOnce();
    } finally {
      this.running = false;
      this.publish();
    }
    if (this.rerun) { this.rerun = false; await this.syncNow(); }
  }

  private async runOnce(): Promise<void> {
    try {
      const result = await this.deps.reconcile();
      this.lastSyncedAt = (this.deps.now ?? Date.now)();
      this.error = null;
      if (result.pulled > 0 || (result.replayed ?? 0) > 0) this.deps.onRemoteChanges?.();
    } catch (err) {
      // Ändringen ligger kvar i kön (persisterad) — nästa runda försöker igen.
      this.error = (await this.authMessage(err)) ?? saveErrorMessage(err);
    }
  }

  /** Ett 401 → låt sessionen omvalideras och visa dess besked (#1245). */
  private async authMessage(err: unknown): Promise<string | null> {
    if (!this.deps.onUnauthorized || !isUnauthorizedError(err)) return null;
    return this.deps.onUnauthorized();
  }

  /** Finns det ändringar som inte nått servern? (varning vid stängning av fliken) */
  hasUnsyncedChanges(): boolean {
    return this.deps.pendingCount() > 0;
  }

  private publish(): void {
    this.deps.onStatus({
      online: this.deps.isOnline(),
      pendingCount: this.deps.pendingCount(),
      syncing: this.running,
      lastSyncedAt: this.lastSyncedAt,
      error: this.error,
    });
  }
}
