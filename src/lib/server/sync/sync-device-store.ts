/**
 * Porten för synkläget per enhet (#1267). Bara server-first-runtimen har en
 * (`DrizzleSyncDevices`); in-process-vägen (demo) saknar den, och
 * sync-routern svarar då NOT_IMPLEMENTED.
 */

import type { SyncDevice, SyncDeviceReport } from "@/lib/shared/sync/device-health";

export interface SyncDeviceStore {
  /** Spara enhetens senaste rapport. En enhet i en annan byrå skrivs aldrig över. */
  report(organizationId: string, userId: string, report: SyncDeviceReport): Promise<void>;
  /** Byråns enheter, senast sedda först. */
  list(organizationId: string): Promise<SyncDevice[]>;
  /** Glöm en enhet (utrangerad dator). Bara inom byrån. */
  forget(organizationId: string, deviceId: string): Promise<void>;
}
