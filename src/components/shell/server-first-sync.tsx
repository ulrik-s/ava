"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { revalidateSession } from "@/lib/client/auth/revalidate-session";
import { setSessionNotice } from "@/lib/client/auth/session-notice";
import { probeSession, type SessionProbe } from "@/lib/client/auth/session-probe";
import { rejectedChanges } from "@/lib/client/backend/rejected-changes";
import { reportSyncDevice } from "@/lib/client/backend/sync-device-report";
import { requestPersistentStorageOnce, type StoragePersistence } from "@/lib/client/storage/persistent-storage";
import { syncStateFromCachingSync, type CachingSyncStatus } from "@/lib/client/sync/caching-sync-status";
import { notifyServerSynced, registerServerSyncFlush } from "@/lib/client/sync/server-sync-flush";
import { withSyncLock } from "@/lib/client/sync/sync-lock";
import { SyncScheduler } from "@/lib/client/sync/sync-scheduler";
import { useRejectedChanges } from "@/lib/client/sync/use-rejected-changes";
import { pluralChanges } from "@/lib/client/utils";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import type { ReconcileResult } from "@/lib/server/data-store/in-memory/reconcile-engine";
import { authFailureOf } from "@/lib/shared/auth-failure";
import { syncErrorMessage } from "@/lib/shared/sync/sync-error";
import { SyncStatusPill } from "./sync-status-pill";

/** Det synken behöver ur server-first-storen — inget mer (smal söm, testbar). */
export type SyncableStore = Pick<CachingSyncDataStore, "reconcile" | "pendingCount" | "oldestPendingAt" | "onLocalChange" | "requeue" | "restore">;

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
  /**
   * Rapportera enhetens synkläge till servern (#1267) — efter varje synk, också
   * en misslyckad, med felet som stoppade den (#1353). Injicerbar för tester.
   */
  reportDevice?: (store: SyncableStore, lastError: string | null) => Promise<void>;
  /**
   * E-posten för den bundna användaren (#1404) — loggar någon annan in i en
   * annan flik laddas sidan om vid nästa 401. `null` = ingen bunden (utan OIDC).
   */
  boundEmail?: string | null;
  /** Proxyfrågan och omladdningen vid 401 (#1351, #1404). Injicerbara för tester. */
  session?: SessionSeams;
}

/** Det omvalideringen vid 401 gör mot webbläsaren. */
export interface SessionSeams {
  /** Fråga proxyn om sessionen. */
  probe: () => Promise<SessionProbe>;
  /** Ladda om sidan — sessionsgrinden tar över. */
  reloadPage: () => void;
}

const BROWSER_SESSION: SessionSeams = { probe: () => probeSession(), reloadPage: () => { window.location.reload(); } };

/**
 * 401 (#1245, #1351): sessionen/token gick ut → "Logga in igen"; kontot
 * spärrat → besked; någon annan loggade in (#1404) → ladda om. `beforeReload`
 * tar bort lämna-varningen först: den förras kö ligger kvar i hennes egna
 * databaser.
 */
function revalidateOn401(
  err: unknown, session: SessionSeams, boundEmail: string | null | undefined, beforeReload: () => void,
): Promise<string | null> {
  return revalidateSession({
    probe: session.probe,
    notify: setSessionNotice,
    boundEmail: boundEmail ?? null,
    reload: () => { beforeReload(); session.reloadPage(); },
  }, authFailureOf(err));
}

const reportToServer = (store: SyncableStore, lastError: string | null): Promise<void> =>
  reportSyncDevice(store, navigator.userAgent, lastError);

/**
 * En synkrunda: reconcile, sedan rapporten — oavsett utfall (#1353). Annars
 * skulle en enhet vars kö fastnat aldrig rapportera, och larmet "fast kö"
 * aldrig gå. Lyckad = hela kön spelades upp; då meddelas lyssnarna (#1243).
 */
async function syncAndReport(store: SyncableStore, report: (store: SyncableStore, lastError: string | null) => Promise<void>): Promise<ReconcileResult> {
  let lastError: string | null = null;
  try {
    const result = await store.reconcile();
    if (result.blocked) lastError = syncErrorMessage(result.blocked.error);
    else notifyServerSynced(); // bara efter en LYCKAD synk (#1243)
    return result;
  } catch (err) {
    lastError = syncErrorMessage(err);
    throw err;
  } finally {
    // Synkläget per enhet (#1267): servern larmar när något fastnat här.
    void report(store, lastError);
  }
}

/**
 * Server-first-synken i webbläsaren: varje sparad ändring skickas till servern
 * direkt (inte först vid nästa sidladdning), läget syns i statuspillen, och man
 * varnas om man stänger fliken innan allt nått servern — eller om osynkade
 * ändringar ligger i en lagring webbläsaren får rensa (#1241).
 */
export function ServerFirstSync({
  store, requestPersistence = requestPersistentStorageOnce, reportDevice = reportToServer, boundEmail, session = BROWSER_SESSION,
}: ServerFirstSyncProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CachingSyncStatus | null>(null);
  const rejected = useRejectedChanges();

  // "Försök igen" (#1266): en avvisad ändring köas på nytt mot den här storen.
  // "Kasta" (#1348): raderna den rörde hämtas från servern; UI:t hämtar om.
  useEffect(() => {
    if (!store) return;
    return rejectedChanges.setHandlers({
      retry: (change) => store.requeue(change.entry, change.current),
      restore: async (change) => {
        if ((await store.restore(change.entry)) > 0) void queryClient.invalidateQueries();
      },
    });
  }, [store, queryClient]);
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
      // En flik i taget skickar kön (#1332).
      reconcile: () => withSyncLock(() => syncAndReport(store, reportDevice)),
      pendingCount: () => store.pendingCount(),
      isOnline: () => navigator.onLine,
      onStatus: setStatus,
      onRemoteChanges: () => { void queryClient.invalidateQueries(); },
      onUnauthorized: (err) => revalidateOn401(err, session, boundEmail, () => { window.removeEventListener("beforeunload", onBeforeUnload); }),
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
  }, [store, queryClient, reportDevice, boundEmail, session]);

  if (!status) return null;
  const atRisk = persistence === "not-persisted" && status.pendingCount > 0;
  return (
    <>
      <SyncStatusPill state={syncStateFromCachingSync({ ...status, conflicts: rejected.length })} />
      {atRisk && <StorageWarning pending={status.pendingCount} />}
    </>
  );
}
