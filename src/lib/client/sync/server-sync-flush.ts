/**
 * Tvinga ut köade ändringar till servern innan ett anrop som läser serverns
 * data (#1176): Fortnox-bokföringen körs på servern mot Postgres, så en nyss
 * registrerad betalning måste ha nått dit först. `ServerFirstSync` registrerar
 * sin scheduler här; utan server-synk (demo) är det en no-op.
 *
 * Registreringen bär också antalet osynkade ändringar (#1241), så att t.ex.
 * utloggningen kan fråga innan den lämnar ändringar som inte nått servern.
 */

type Flush = () => Promise<void>;
type PendingCount = () => number;

interface Registration {
  flush: Flush;
  pendingCount: PendingCount;
}

// ponytail: en modul-global — det finns exakt en server-synk per flik.
let current: Registration | null = null;

/** Registrera synkens flush (och räknare); returnerar avregistreringen. */
export function registerServerSyncFlush(flush: Flush, pendingCount: PendingCount = () => 0): () => void {
  const registration: Registration = { flush, pendingCount };
  current = registration;
  return () => { if (current === registration) current = null; };
}

/** Synka nu; kastar om ändringar fortfarande inte nått servern. */
export async function flushServerSync(): Promise<void> {
  await current?.flush();
}

/** Antal ändringar som inte nått servern (0 utan server-synk). */
export function unsyncedChangeCount(): number {
  return current?.pendingCount() ?? 0;
}

// Lyssnare på lyckade server-synkar (#1243) — t.ex. uppskjutna fakturadokument
// som kan skapas när servern satt fakturans nummer.
const syncedListeners = new Set<() => void>();

/** Lyssna på lyckade server-synkar; returnerar avregistreringen. */
export function onServerSynced(listener: () => void): () => void {
  syncedListeners.add(listener);
  return () => { syncedListeners.delete(listener); };
}

/** Anropas av server-synken efter varje lyckad reconcile. En kastande lyssnare stoppar inte de andra. */
export function notifyServerSynced(): void {
  for (const listener of syncedListeners) {
    try {
      listener();
    } catch (e) {
      console.warn("[server-sync] lyssnare kastade:", e);
    }
  }
}
