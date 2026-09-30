/**
 * `DrizzleSyncDevices` (#1267) — synkläget per enhet i Postgres
 * (`sync_devices`). Server-only.
 */

import { and, desc, eq } from "drizzle-orm";
import type { SyncDevice, SyncDeviceReport } from "@/lib/shared/sync/device-health";
import { syncDevices } from "../db/schema";
import type { AppDb } from "../db/types";
import type { SyncDeviceStore } from "./sync-device-store";

type Row = typeof syncDevices.$inferSelect;

function toDevice(r: Row): SyncDevice {
  return {
    deviceId: r.deviceId, userId: r.userId, label: r.label, pendingCount: r.pendingCount,
    oldestPendingAt: r.oldestPendingAt ? r.oldestPendingAt.getTime() : null,
    lastSeenAt: r.lastSeenAt.getTime(),
  };
}

export class DrizzleSyncDevices implements SyncDeviceStore {
  constructor(private readonly db: AppDb, private readonly now: () => Date = () => new Date()) {}

  async report(organizationId: string, userId: string, r: SyncDeviceReport): Promise<void> {
    const values = {
      userId, label: r.label, pendingCount: r.pendingCount,
      oldestPendingAt: r.oldestPendingAt === null ? null : new Date(r.oldestPendingAt),
      lastSeenAt: this.now(),
    };
    // En enhet som redan finns i en ANNAN byrå skrivs inte över (`where`).
    await this.db.insert(syncDevices).values({ deviceId: r.deviceId, organizationId, ...values })
      .onConflictDoUpdate({ target: syncDevices.deviceId, set: values, where: eq(syncDevices.organizationId, organizationId) });
  }

  async list(organizationId: string): Promise<SyncDevice[]> {
    const rows = await this.db.select().from(syncDevices)
      .where(eq(syncDevices.organizationId, organizationId)).orderBy(desc(syncDevices.lastSeenAt));
    return rows.map(toDevice);
  }

  async forget(organizationId: string, deviceId: string): Promise<void> {
    await this.db.delete(syncDevices)
      .where(and(eq(syncDevices.deviceId, deviceId), eq(syncDevices.organizationId, organizationId)));
  }
}
