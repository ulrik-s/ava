/**
 * En flik i taget skickar kön (#1332).
 *
 * Varje flik har sin egen kopia av kön. Två flikar som får nätet tillbaka
 * samtidigt skickar annars samma anrop till servern samtidigt. Servern
 * klarar det (ett lås per anrop), men låset här gör att det sällan behövs.
 * Web Locks är en webbläsarfunktion, så låset fungerar också offline. Den
 * finns bara på säkra sidor (https eller localhost); annars körs synken utan
 * lås, som förut.
 *
 * Det täcker bara flikar i samma webbläsare: två enheter, eller ett omförsök
 * medan servern fortfarande kör det första, skyddas av servern.
 */

/** Namnet på låset alla flikar delar. */
export const SYNC_LOCK_NAME = "ava-sync";

/** Den del av `navigator.locks` som används (injicerbar i tester). */
export interface SyncLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** `navigator.locks`, om webbläsaren har Web Locks. */
function browserLocks(): SyncLocks | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

/** Kör `fn` under synklåset. Saknas Web Locks körs den direkt, som förut. */
export function withSyncLock<T>(fn: () => Promise<T>, locks: SyncLocks | undefined = browserLocks()): Promise<T> {
  return locks ? locks.request(SYNC_LOCK_NAME, fn) : fn();
}
