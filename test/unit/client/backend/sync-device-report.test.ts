/** Rapporten efter en synk (#1267) — bäst-möjligt, fäller aldrig synken; bär felet om synken misslyckades (#1353). */
import { describe, expect, it } from "vitest-compat";
import { buildDeviceReport, reportSyncDevice } from "@/lib/client/backend/sync-device-report";
import type { SyncDeviceReport } from "@/lib/shared/sync/device-health";

const store = { pendingCount: () => 2, oldestPendingAt: () => 1_700_000_000_000 };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36";

describe("reportSyncDevice", () => {
  it("rapporten bär köns längd, äldsta ändring och enhetens etikett", () => {
    expect(buildDeviceReport(store, UA, null, "dev-1")).toEqual({ deviceId: "dev-1", label: "Chrome på macOS", pendingCount: 2, oldestPendingAt: 1_700_000_000_000, lastError: null });
  });

  it("efter en misslyckad synk bär rapporten felet (#1353)", () => {
    expect(buildDeviceReport(store, UA, "Kunde inte spara", "dev-1")).toMatchObject({ pendingCount: 2, lastError: "Kunde inte spara" });
  });

  it("skickas till servern", async () => {
    const sent: SyncDeviceReport[] = [];
    await reportSyncDevice(store, UA, null, async (r) => { sent.push(r); });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ pendingCount: 2, label: "Chrome på macOS" });
  });

  it("ett fel sväljs — synken fälls inte", async () => {
    await expect(reportSyncDevice(store, UA, null, async () => { throw new Error("nätet"); })).resolves.toBeUndefined();
  });

  it("utan server (default-vägen) kastar den inte heller", async () => {
    await expect(reportSyncDevice(store, UA, null)).resolves.toBeUndefined();
  });
});
