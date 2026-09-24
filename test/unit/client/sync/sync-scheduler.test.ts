/**
 * `SyncScheduler` — ändringar ska nå servern direkt efter att de sparats, inte
 * först vid nästa sidladdning (dataförlusten på ava-crm.io 2026-09-23).
 */
import { describe, expect, it } from "bun:test";
import type { CachingSyncStatus } from "@/lib/client/sync/caching-sync-status";
import { SyncScheduler, type SyncSchedulerDeps } from "@/lib/client/sync/sync-scheduler";

function harness(over: Partial<SyncSchedulerDeps> = {}) {
  const timers: Array<() => void> = [];
  const statuses: CachingSyncStatus[] = [];
  let pending = 0;
  let online = true;
  const calls = { reconcile: 0, remote: 0 };
  let reconcileImpl: () => Promise<{ pulled: number }> = async () => { pending = 0; return { pulled: 0 }; };
  const scheduler = new SyncScheduler({
    reconcile: () => { calls.reconcile++; return reconcileImpl(); },
    pendingCount: () => pending,
    isOnline: () => online,
    onStatus: (s) => statuses.push(s),
    onRemoteChanges: () => { calls.remote++; },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (h) => { timers[(h as number) - 1] = () => {}; },
    now: () => 1000,
    ...over,
  });
  return {
    scheduler, statuses, calls, timers,
    setPending: (n: number) => { pending = n; },
    setOnline: (v: boolean) => { online = v; },
    setReconcile: (fn: () => Promise<{ pulled: number }>) => { reconcileImpl = fn; },
    fireTimers: async () => { const fns = timers.splice(0); for (const f of fns) f(); await Promise.resolve(); await Promise.resolve(); },
    last: () => statuses[statuses.length - 1]!,
  };
}

describe("SyncScheduler", () => {
  it("en sparad ändring synkas strax efteråt — inte först vid nästa sidladdning", async () => {
    const h = harness();
    h.setPending(1);
    h.scheduler.notifyChange();
    expect(h.calls.reconcile).toBe(0); // debounce
    await h.fireTimers();
    expect(h.calls.reconcile).toBe(1);
    expect(h.last()).toMatchObject({ pendingCount: 0, syncing: false, lastSyncedAt: 1000, error: null });
  });

  it("flera sparningar i rad blir EN synk", async () => {
    const h = harness();
    h.scheduler.notifyChange();
    h.scheduler.notifyChange();
    h.scheduler.notifyChange();
    await h.fireTimers();
    expect(h.calls.reconcile).toBe(1);
  });

  it("aldrig två synkar samtidigt — en ändring under pågående synk ger en ny runda efteråt", async () => {
    const h = harness();
    let release!: () => void;
    h.setReconcile(() => new Promise((r) => { release = () => r({ pulled: 0 }); }));
    const first = h.scheduler.syncNow();
    void h.scheduler.syncNow(); // under pågående → markeras för ny runda
    expect(h.calls.reconcile).toBe(1);
    h.setReconcile(async () => ({ pulled: 0 }));
    release();
    await first;
    expect(h.calls.reconcile).toBe(2);
  });

  it("fel: ändringen ligger kvar och felet syns — nästa runda lyckas och rensar felet", async () => {
    const h = harness();
    h.setPending(2);
    h.setReconcile(async () => { throw new Error("502 Bad Gateway"); });
    await h.scheduler.syncNow();
    expect(h.last()).toMatchObject({ pendingCount: 2, error: expect.stringContaining("502 Bad Gateway") });
    expect(h.scheduler.hasUnsyncedChanges()).toBe(true);

    h.setReconcile(async () => { h.setPending(0); return { pulled: 0 }; });
    await h.scheduler.syncNow();
    expect(h.last()).toMatchObject({ pendingCount: 0, error: null });
    expect(h.scheduler.hasUnsyncedChanges()).toBe(false);
  });

  it("offline: försöker inte, men visar att ändringar väntar", async () => {
    const h = harness();
    h.setOnline(false);
    h.setPending(3);
    await h.scheduler.syncNow();
    expect(h.calls.reconcile).toBe(0);
    expect(h.last()).toMatchObject({ online: false, pendingCount: 3 });
  });

  it("andras ändringar (pull > 0) → UI:t hämtar om", async () => {
    const h = harness();
    h.setReconcile(async () => ({ pulled: 4 }));
    await h.scheduler.syncNow();
    expect(h.calls.remote).toBe(1);
  });
});
