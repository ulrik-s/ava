"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { requestPersistentStorageOnce, type StoragePersistence } from "@/lib/client/storage/persistent-storage";
import { syncStateFromCachingSync, type CachingSyncStatus } from "@/lib/client/sync/caching-sync-status";
import { notifyServerSynced, registerServerSyncFlush } from "@/lib/client/sync/server-sync-flush";
import { SyncScheduler } from "@/lib/client/sync/sync-scheduler";
import { pluralChanges } from "@/lib/client/utils";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { SyncStatusPill } from "./sync-status-pill";

/** Det synken behöver ur server-first-storen — inget mer (smal söm, testbar). */
export type SyncableStore = Pick<CachingSyncDataStore, "reconcile" | "pendingCount" | "onLocalChange">;

/** Periodisk synk: fångar andras ändringar och gör om efter fel. */
const PERIODIC_SYNC_MS = 30_000;

/**
 * Varning när osynkade ändringar ligger i en lagring som webbläsaren får rensa
 * (#1241) — då är fliken det enda som håller dem kvar tills synken lyckas.
 */
function StorageWarning({ pending }: { pending: number }) {
  return (
    <span
      data-testid="storage-warning"
      title={`${pending} ${pluralChanges(pending)} finns bara i den här webbläsaren, och den har inte lovat att behålla lagringen. Låt fliken vara öppen tills statusen visar "Sparat".`}
      className="text-xs px-2 py-1 rounded border inline-flex items-center gap-1.5 bg-amber-50 text-amber-900 border-amber-300"
    >
      <span aria-hidden>⚠</span>
      <span>Lokal lagring kan rensas</span>
    </span>
  );
}

interface ServerFirstSyncProps {
  store: SyncableStore | null;
  /** Be om beständig lagring (#1241). Injicerbar för tester. */
  requestPersistence?: () => Promise<StoragePersistence>;
}

/**
 * Server-first-synken i webbläsaren: varje sparad ändring skickas till servern
 * direkt (inte först vid nästa sidladdning), läget syns i statuspillen, och man
 * varnas om man stänger fliken innan allt nått servern — eller om osynkade
 * ändringar ligger i en lagring webbläsaren får rensa (#1241).
 */
export function ServerFirstSync({ store, requestPersistence = requestPersistentStorageOnce }: ServerFirstSyncProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CachingSyncStatus | null>(null);
  const [persistence, setPersistence] = useState<StoragePersistence | null>(null);

  useEffect(() => {
    if (!store) return;
    let active = true;
    void requestPersistence().then((p) => { if (active) setPersistence(p); });
    return () => { active = false; };
  }, [store, requestPersistence]);

  useEffect(() => {
    if (!store) return;
    const scheduler = new SyncScheduler({
      reconcile: async () => {
        const result = await store.reconcile();
        notifyServerSynced(); // bara efter en LYCKAD synk (#1243)
        return result;
      },
      pendingCount: () => store.pendingCount(),
      isOnline: () => navigator.onLine,
      onStatus: setStatus,
      onRemoteChanges: () => { void queryClient.invalidateQueries(); },
    });
    const unsubscribe = store.onLocalChange(() => scheduler.notifyChange());
    const unregister = registerServerSyncFlush(async () => {
      await scheduler.syncNow();
      if (scheduler.hasUnsyncedChanges()) throw new Error("Alla ändringar har inte nått servern än — försök igen om en stund.");
    }, () => store.pendingCount());
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
  const atRisk = persistence === "not-persisted" && status.pendingCount > 0;
  return (
    <>
      <SyncStatusPill state={syncStateFromCachingSync(status)} />
      {atRisk && <StorageWarning pending={status.pendingCount} />}
    </>
  );
}
