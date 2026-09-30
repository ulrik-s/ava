/**
 * Synklåset (#1332): en flik i taget skickar kön. Utan Web Locks körs synken
 * som förut.
 */
import { describe, expect, it } from "vitest-compat";
import { SYNC_LOCK_NAME, withSyncLock, type SyncLocks } from "@/lib/client/sync/sync-lock";

/** Web Locks i miniatyr: ett exklusivt lås per namn, i anropsordning. */
function fakeLocks(): SyncLocks & { names: string[] } {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  return {
    names,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(callback);
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}

describe("withSyncLock", () => {
  it("två samtidiga synkar körs efter varandra, under det delade låset", async () => {
    const locks = fakeLocks();
    const events: string[] = [];
    const sync = (tab: string) => withSyncLock(async () => {
      events.push(`${tab} start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${tab} slut`);
      return tab;
    }, locks);
    expect(await Promise.all([sync("A"), sync("B")])).toEqual(["A", "B"]);
    expect(events).toEqual(["A start", "A slut", "B start", "B slut"]);
    expect(locks.names).toEqual([SYNC_LOCK_NAME, SYNC_LOCK_NAME]);
  });

  it("ett fel i synken når anroparen och släpper låset", async () => {
    const locks = fakeLocks();
    await expect(withSyncLock(async () => { throw new Error("nätet"); }, locks)).rejects.toThrow("nätet");
    expect(await withSyncLock(async () => "nästa", locks)).toBe("nästa");
  });

  it("utan Web Locks körs synken direkt", async () => {
    expect(await withSyncLock(async () => 42, undefined)).toBe(42);
  });

  it("webbläsarens lås används när inget injiceras", async () => {
    expect(await withSyncLock(async () => "ok")).toBe("ok");
  });
});
