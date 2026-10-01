/**
 * Utloggning när ändringar inte nått servern (#1241, #1347).
 *
 * Ett sista synkförsök först; når allt fram går utloggningen igenom utan fråga.
 * Annars frågar dialogen (`SignOutDialog`), med antalet ändringar: synka igen,
 * logga ut ändå (ändringarna ligger kvar i användarens egna databaser till
 * nästa inloggning som samma användare) eller avbryt. En utloggning mitt i ett
 * avbrott ska vara ett medvetet val, inte något man upptäcker när ändringarna
 * saknas.
 */

import { pluralChanges } from "@/lib/client/utils";
import { flushServerSync, unsyncedChangeCount } from "./server-sync-flush";

/** Beroendena (injicerbara för tester). */
export interface SyncBeforeSignOutDeps {
  flush: () => Promise<void>;
  pendingCount: () => number;
  /** Hur länge synken får ta innan frågan ställs (en hängande server ska inte frysa knappen). */
  flushTimeoutMs?: number;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

/** Vänta på `p`, men högst `ms`; fel och tidsgräns räknas lika (frågan avgör). */
async function settleWithin(p: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  await Promise.race([p.catch(() => undefined), expired]).finally(() => clearTimeout(timer));
}

/** Frågan när `count` ändringar inte nått servern. */
export function unsyncedSignOutMessage(count: number): string {
  return `Du har ${count} ${count === 1 ? "osynkad" : "osynkade"} ${pluralChanges(count)}.`;
}

const defaultDeps = (): SyncBeforeSignOutDeps => ({ flush: flushServerSync, pendingCount: unsyncedChangeCount });

/** Synka (högst en stund) och svara med antalet ändringar som ändå inte nått servern. */
export async function syncBeforeSignOut(deps: SyncBeforeSignOutDeps = defaultDeps()): Promise<number> {
  await settleWithin(deps.flush(), deps.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS);
  return deps.pendingCount();
}
