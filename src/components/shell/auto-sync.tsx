"use client";

/**
 * `AutoSync` — visar bara den globala status-pillen. All sync-logik
 * äger `SyncProviderRoot` i `demo-bootstrap.tsx` (delas mellan pillen
 * och `SyncDiagnostics` i /settings).
 */

import { useSyncContext } from "@/lib/client/sync/sync-context";
import { SyncStatusPill } from "./sync-status-pill";

export function AutoSync() {
  const { state, providerKind } = useSyncContext();
  if (!providerKind) return null;
  return <SyncStatusPill state={state} />;
}
