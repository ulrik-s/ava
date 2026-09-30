/** Synkläget per enhet (#1267): när en enhet larmar. */
import { describe, expect, it } from "vitest-compat";
import { deviceHealth, devicesNeedingAttention, SILENT_AFTER_MS, STUCK_AFTER_MS } from "@/lib/shared/sync/device-health";

const NOW = Date.UTC(2026, 8, 30, 12, 0);

describe("deviceHealth", () => {
  it("nyss synkad utan kö → ok", () => {
    expect(deviceHealth({ pendingCount: 0, oldestPendingAt: null, lastSeenAt: NOW }, NOW)).toBe("ok");
  });

  it("en osynkad ändring yngre än ett dygn → ok", () => {
    expect(deviceHealth({ pendingCount: 2, oldestPendingAt: NOW - STUCK_AFTER_MS + 1, lastSeenAt: NOW }, NOW)).toBe("ok");
  });

  it("en osynkad ändring ett dygn gammal → stuck, också när enheten tystnat", () => {
    expect(deviceHealth({ pendingCount: 1, oldestPendingAt: NOW - STUCK_AFTER_MS, lastSeenAt: NOW }, NOW)).toBe("stuck");
    expect(deviceHealth({ pendingCount: 1, oldestPendingAt: NOW - SILENT_AFTER_MS * 2, lastSeenAt: NOW - SILENT_AFTER_MS * 2 }, NOW)).toBe("stuck");
  });

  it("ingen synk på en vecka → silent", () => {
    expect(deviceHealth({ pendingCount: 0, oldestPendingAt: null, lastSeenAt: NOW - SILENT_AFTER_MS }, NOW)).toBe("silent");
  });

  it("kö utan känd tidpunkt larmar inte som stuck", () => {
    expect(deviceHealth({ pendingCount: 3, oldestPendingAt: null, lastSeenAt: NOW }, NOW)).toBe("ok");
  });
});

describe("devicesNeedingAttention", () => {
  it("bara enheterna som larmar", () => {
    const ok = { id: "a", pendingCount: 0, oldestPendingAt: null, lastSeenAt: NOW };
    const silent = { id: "b", pendingCount: 0, oldestPendingAt: null, lastSeenAt: NOW - SILENT_AFTER_MS };
    expect(devicesNeedingAttention([ok, silent], NOW)).toEqual([silent]);
  });
});
