/**
 * `syncStateFromCachingSync` (#416, ADR 0016) — adaptern som låter den BEFINTLIGA
 * sync-status-UI:n (`SyncStatusPill` + `SyncState`) visa offline-first-
 * `CachingSyncDataStore`-vägens läge (#415), utan att duplicera UI.
 *
 * Git-backendens sync drivs av `useAutoSync` (commit→pull→push); server-first-
 * vägen drivs i stället av `CachingSyncDataStore` (kö + reconcile). Båda mynnar
 * ut i samma `SyncState` → samma pill, samma mentala modell för användaren.
 *
 * Mappningen är en prioritetsordning (mest brådskande först): fel > synkar >
 * konflikt(er) > offline > köad > synkad > idle.
 */

import type { SyncState } from "./use-auto-sync";

export interface CachingSyncStatus {
  /** `navigator.onLine` (via `useOnlineStatus`). */
  online: boolean;
  /** Antal ej-synkade mutationer (`CachingSyncDataStore.pendingCount()`). */
  pendingCount: number;
  /** En reconcile pågår just nu. */
  syncing?: boolean;
  /** Epoch-ms för senaste lyckade reconcile (null = aldrig). */
  lastSyncedAt?: number | null;
  /** Antal ytlagda surface-konflikter från senaste reconcile. */
  conflicts?: number;
  /** Felmeddelande från senaste reconcile (null = inget fel). */
  error?: string | null;
}

/** Härled den UI-vänliga `SyncState` ur offline-first-storens läge. */
export function syncStateFromCachingSync(status: CachingSyncStatus): SyncState {
  if (status.error) return { kind: "error", message: status.error };
  if (status.syncing) return { kind: "syncing", what: "push" };
  if ((status.conflicts ?? 0) > 0) return { kind: "merge-needed" };
  if (!status.online) return { kind: "offline", count: status.pendingCount };
  if (status.pendingCount > 0) return { kind: "pending", count: status.pendingCount };
  if (status.lastSyncedAt != null) return { kind: "synced", at: status.lastSyncedAt };
  return { kind: "idle" };
}
