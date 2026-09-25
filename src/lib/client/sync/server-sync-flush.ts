/**
 * Tvinga ut köade ändringar till servern innan ett anrop som läser serverns
 * data (#1176): Fortnox-bokföringen körs på servern mot Postgres, så en nyss
 * registrerad betalning måste ha nått dit först. `ServerFirstSync` registrerar
 * sin scheduler här; utan server-synk (demo) är det en no-op.
 */

type Flush = () => Promise<void>;

// ponytail: en modul-global — det finns exakt en server-synk per flik.
let current: Flush | null = null;

/** Registrera synkens flush; returnerar avregistreringen. */
export function registerServerSyncFlush(flush: Flush): () => void {
  current = flush;
  return () => { if (current === flush) current = null; };
}

/** Synka nu; kastar om ändringar fortfarande inte nått servern. */
export async function flushServerSync(): Promise<void> {
  await current?.();
}
