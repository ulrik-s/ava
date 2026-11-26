/** Synkläget per enhet (#1267): när en enhet larmar. */
import { describe, expect, it } from "vitest-compat";
import { deviceHealth, devicesNeedingAttention, SILENT_AFTER_MS, STUCK_AFTER_MS, syncDeviceReportSchema } from "@/lib/shared/sync/device-health";
import { MAX_SYNC_ERROR_LENGTH } from "@/lib/shared/sync/sync-error";

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

describe("syncDeviceReportSchema (#1849)", () => {
  const report = { deviceId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", label: "Chrome på macOS", pendingCount: 2, oldestPendingAt: NOW, lastError: null };

  it("en rapport inom gränserna tas emot", () => {
    expect(syncDeviceReportSchema.parse(report)).toEqual(report);
    expect(syncDeviceReportSchema.parse({ ...report, label: null, oldestPendingAt: null, lastError: "x".repeat(MAX_SYNC_ERROR_LENGTH) })).toMatchObject({ label: null });
  });

  it("en klient före fältet lastError får null", () => {
    const { lastError: _, ...old } = report;
    expect(syncDeviceReportSchema.parse(old).lastError).toBeNull();
  });

  it("gränserna avvisar", () => {
    const bad = [
      { deviceId: "inte-ett-uuid" },
      { label: "x".repeat(121) },
      { pendingCount: -1 },
      { pendingCount: 1.5 },
      { oldestPendingAt: -1 },
      { lastError: "x".repeat(MAX_SYNC_ERROR_LENGTH + 1) },
    ];
    for (const change of bad) expect(syncDeviceReportSchema.safeParse({ ...report, ...change }).success).toBe(false);
  });
});
