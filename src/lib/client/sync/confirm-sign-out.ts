/**
 * `confirmSignOutIfUnsynced` (#1241) — utloggning när ändringar inte nått
 * servern.
 *
 * Ett sista synkförsök först; når allt fram går utloggningen igenom utan fråga.
 * Annars frågar vi, med antalet ändringar — en utloggning mitt i ett avbrott ska
 * vara ett medvetet val, inte något man upptäcker när ändringarna saknas.
 */

import { pluralChanges } from "@/lib/client/utils";
import { flushServerSync, unsyncedChangeCount } from "./server-sync-flush";

/** Beroendena (injicerbara för tester). */
export interface ConfirmSignOutDeps {
  flush: () => Promise<void>;
  pendingCount: () => number;
  confirm: (message: string) => boolean;
  /** Hur länge den sista synken får ta innan frågan ställs (en hängande server ska inte frysa knappen). */
  flushTimeoutMs?: number;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

/** Vänta på `p`, men högst `ms`; fel och tidsgräns räknas lika (frågan avgör). */
async function settleWithin(p: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  await Promise.race([p.catch(() => undefined), expired]).finally(() => clearTimeout(timer));
}

/** Frågan som ställs när `count` ändringar inte nått servern. */
export function unsyncedSignOutMessage(count: number): string {
  return `${count} ${pluralChanges(count)} har inte nått servern än. `
    + "Loggar du ut nu ligger de kvar i den här webbläsaren och kan gå förlorade om den rensar sin lagring. "
    + "Vänta tills statusen visar \"Sparat\" om du kan.\n\nLogga ut ändå?";
}

const defaultDeps = (): ConfirmSignOutDeps => ({
  flush: flushServerSync,
  pendingCount: unsyncedChangeCount,
  confirm: (message) => window.confirm(message),
});

/** `true` → fortsätt logga ut. */
export async function confirmSignOutIfUnsynced(deps: ConfirmSignOutDeps = defaultDeps()): Promise<boolean> {
  await settleWithin(deps.flush(), deps.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS);
  const pending = deps.pendingCount();
  return pending === 0 || deps.confirm(unsyncedSignOutMessage(pending));
}
