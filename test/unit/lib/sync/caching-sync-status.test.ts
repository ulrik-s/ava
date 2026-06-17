/**
 * `syncStateFromCachingSync` (#416) — offline-first-store → SyncState-adapter.
 */

import { describe, it, expect } from "vitest-compat";
import { syncStateFromCachingSync } from "@/lib/client/sync/caching-sync-status";

const base = { online: true, pendingCount: 0 };

describe("syncStateFromCachingSync", () => {
  it("idle utan kö, online, aldrig synkat", () => {
    expect(syncStateFromCachingSync(base)).toEqual({ kind: "idle" });
  });

  it("synced när senast-synkat finns och kön är tom", () => {
    expect(syncStateFromCachingSync({ ...base, lastSyncedAt: 1234 })).toEqual({ kind: "synced", at: 1234 });
  });

  it("pending när köade mutationer finns (online)", () => {
    expect(syncStateFromCachingSync({ ...base, pendingCount: 3 })).toEqual({ kind: "pending", count: 3 });
  });

  it("offline (med pending-count) väger tyngre än pending", () => {
    expect(syncStateFromCachingSync({ online: false, pendingCount: 2 })).toEqual({ kind: "offline", count: 2 });
  });

  it("merge-needed vid surface-konflikter", () => {
    expect(syncStateFromCachingSync({ ...base, pendingCount: 1, conflicts: 1 })).toEqual({ kind: "merge-needed" });
  });

  it("syncing väger tyngre än konflikt/offline/pending", () => {
    expect(syncStateFromCachingSync({ online: false, pendingCount: 5, conflicts: 2, syncing: true })).toEqual({
      kind: "syncing",
      what: "push",
    });
  });

  it("error har högsta prioritet", () => {
    expect(
      syncStateFromCachingSync({ ...base, pendingCount: 9, syncing: true, error: "trasig sync" }),
    ).toEqual({ kind: "error", message: "trasig sync" });
  });
});
