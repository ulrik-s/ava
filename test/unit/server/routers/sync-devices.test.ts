/**
 * `sync.reportDevice` / `sync.devices` / `sync.forgetDevice` (#1267): vem som
 * får rapportera och vem som får se.
 */
import { describe, expect, it } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import type { SyncDeviceStore } from "@/lib/server/sync/sync-device-store";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import type { SyncDevice, SyncDeviceReport } from "@/lib/shared/sync/device-health";
import { uuidv7 } from "@/lib/shared/uuid";

const ORG = uuidv7();
const USER = uuidv7();

function fakeStore(): SyncDeviceStore & { reports: Array<{ org: string; user: string; report: SyncDeviceReport }>; forgotten: string[] } {
  const reports: Array<{ org: string; user: string; report: SyncDeviceReport }> = [];
  const forgotten: string[] = [];
  return {
    reports, forgotten,
    report: async (org, user, report) => { reports.push({ org, user, report }); },
    list: async (org): Promise<SyncDevice[]> => reports.filter((r) => r.org === org).map((r) => ({ ...r.report, userId: r.user, lastSeenAt: 1 })),
    forget: async (_org, deviceId) => { forgotten.push(deviceId); },
  };
}

function caller(role: "ADMIN" | "LAWYER", syncDevices?: SyncDeviceStore) {
  const ds = new DemoDataStore({});
  const ctx: Context = buildContext({
    dataStore: ds, ports: buildGitPorts(ds),
    principal: { id: asId<"UserId">(USER), email: "a@byra.se", name: "A", role, organizationId: asId<"OrganizationId">(ORG) },
  });
  return appRouter.createCaller(syncDevices ? { ...ctx, syncDevices } : ctx);
}

const report = (): SyncDeviceReport => ({ deviceId: uuidv7(), label: "Chrome på macOS", pendingCount: 2, oldestPendingAt: 1000 });

describe("sync-routerns enhetsuppföljning (#1267)", () => {
  it("vem som helst i byrån rapporterar sin enhet — som sig själv, i sin byrå", async () => {
    const store = fakeStore();
    const r = report();
    expect(await caller("LAWYER", store).sync.reportDevice(r)).toEqual({ ok: true });
    expect(store.reports).toEqual([{ org: ORG, user: USER, report: r }]);
  });

  it("admin ser byråns enheter och kan glömma en", async () => {
    const store = fakeStore();
    const r = report();
    await caller("ADMIN", store).sync.reportDevice(r);
    expect(await caller("ADMIN", store).sync.devices()).toEqual([expect.objectContaining({ deviceId: r.deviceId, userId: USER })]);
    expect(await caller("ADMIN", store).sync.forgetDevice({ deviceId: r.deviceId })).toEqual({ ok: true });
    expect(store.forgotten).toEqual([r.deviceId]);
  });

  it("den som inte är admin får inte se eller glömma enheter", async () => {
    const store = fakeStore();
    await expect(caller("LAWYER", store).sync.devices()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("LAWYER", store).sync.forgetDevice({ deviceId: uuidv7() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("indatat valideras: negativt antal och icke-uuid avvisas", async () => {
    const store = fakeStore();
    await expect(caller("LAWYER", store).sync.reportDevice({ ...report(), pendingCount: -1 })).rejects.toThrow();
    await expect(caller("LAWYER", store).sync.reportDevice({ ...report(), deviceId: "x" })).rejects.toThrow();
  });

  it("utan server (demo) → NOT_IMPLEMENTED", async () => {
    await expect(caller("ADMIN").sync.reportDevice(report())).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});
