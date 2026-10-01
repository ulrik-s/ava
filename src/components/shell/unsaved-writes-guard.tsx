"use client";

/**
 * `UnsavedWritesGuard` (#1386) — varnar innan fliken stängs eller laddas om
 * medan en lokal ändring fortfarande skrivs till IndexedDB.
 *
 * En mutation svarar först när kö-posten och snapshotet är skrivna, så det som
 * syns som sparat finns kvar efter en omladdning. Under själva skrivningen
 * (millisekunder, längre på en långsam mobil) skulle en omladdning däremot
 * avbryta den. `beforeunload` registreras bara medan en skrivning pågår: en
 * permanent lyssnare stänger av bakåt/framåt-cachen i vissa webbläsare.
 * Gäller demo och self-hosted (self-hosted varnar dessutom för osynkade ändringar).
 */

import { useEffect } from "react";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";

function warnBeforeUnload(e: Event): void {
  e.preventDefault();
}

export function UnsavedWritesGuard({ store }: { store: CachingSyncDataStore | null }) {
  useEffect(() => {
    if (!store) return;
    const writes = store.pendingWrites;
    const sync = (busy: boolean): void => {
      if (busy) window.addEventListener("beforeunload", warnBeforeUnload);
      else window.removeEventListener("beforeunload", warnBeforeUnload);
    };
    sync(writes.busy());
    const unsubscribe = writes.subscribe(sync);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [store]);
  return null;
}
