/**
 * Web Locks i miniatyr (#1332, #1758): ett exklusivt lås per namn, i
 * anropsordning. Registrerar vilka lås som begärts och om något hålls just nu.
 */

import type { SyncLocks } from "@/lib/client/sync/sync-lock";

/** En `SyncLocks`-attrapp som också visar vad som begärts och hålls. */
export interface FakeLocks extends SyncLocks {
  /** Namnen på alla begärda lås, i anropsordning. */
  readonly names: string[];
  /** Hålls något lås just nu (en callback körs)? */
  readonly held: () => boolean;
}

/** Ny attrapp utan begärda lås. */
export function fakeLocks(): FakeLocks {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  let active = 0;
  const hold = async <T>(callback: () => Promise<T>): Promise<T> => {
    active++;
    try {
      return await callback();
    } finally {
      active--;
    }
  };
  return {
    names,
    held: () => active > 0,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(() => hold(callback));
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}
