"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { syncStateFromCachingSync, type CachingSyncStatus } from "@/lib/client/sync/caching-sync-status";
import { registerServerSyncFlush } from "@/lib/client/sync/server-sync-flush";
import { SyncScheduler } from "@/lib/client/sync/sync-scheduler";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { SyncStatusPill } from "./sync-status-pill";

/** Det synken behöver ur server-first-storen — inget mer (smal söm, testbar). */
export type SyncableStore = Pick<CachingSyncDataStore, "reconcile" | "pendingCount" | "onLocalChange">;

/** Periodisk synk: fångar andras ändringar och gör om efter fel. */
const PERIODIC_SYNC_MS = 30_000;

/**
 * Server-first-synken i webbläsaren: varje sparad ändring skickas till servern
 * direkt (inte först vid nästa sidladdning), läget syns i statuspillen, och man
 * varnas om man stänger fliken innan allt nått servern.
 */
export function ServerFirstSync({ store }: { store: SyncableStore | null }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CachingSyncStatus | null>(null);

  useEffect(() => {
    if (!store) return;
    const scheduler = new SyncScheduler({
      reconcile: () => store.reconcile(),
      pendingCount: () => store.pendingCount(),
      isOnline: () => navigator.onLine,
      onStatus: setStatus,
      onRemoteChanges: () => { void queryClient.invalidateQueries(); },
    });
    const unsubscribe = store.onLocalChange(() => scheduler.notifyChange());
    const unregister = registerServerSyncFlush(async () => {
      await scheduler.syncNow();
      if (scheduler.hasUnsyncedChanges()) throw new Error("Alla ändringar har inte nått servern än — försök igen om en stund.");
    });
    const interval = setInterval(() => { void scheduler.syncNow(); }, PERIODIC_SYNC_MS);
    const onOnline = () => { void scheduler.syncNow(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (scheduler.hasUnsyncedChanges()) e.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    // Det som köats innan komponenten monterade (t.ex. räddade rader) skickas nu.
    void scheduler.syncNow();
    return () => {
      unsubscribe();
      unregister();
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [store, queryClient]);

  if (!status) return null;
  return <SyncStatusPill state={syncStateFromCachingSync(status)} />;
}
