"use client";

/**
 * Rapportera enhetens synkläge till servern efter en synk (#1267): hur många
 * ändringar som ligger kvar och när den äldsta gjordes. Servern larmar admin
 * när en ändring fastnat i en webbläsare, eller när en enhet slutat synka.
 *
 * Bäst-möjligt: en rapport som inte kommer fram fäller aldrig synken — nästa
 * lyckade synk rapporterar igen.
 */

import { deviceId, deviceLabel } from "@/lib/client/sync/device-id";
import type { SyncDeviceReport } from "@/lib/shared/sync/device-health";
import { serverTrpcClient } from "./server-trpc-client";

/** Det rapporten läser ur storen. */
export interface ReportableStore {
  pendingCount(): number;
  oldestPendingAt(): number | null;
}

/** Enhetens rapport just nu. */
export function buildDeviceReport(store: ReportableStore, userAgent: string, id: string = deviceId()): SyncDeviceReport {
  return { deviceId: id, label: deviceLabel(userAgent), pendingCount: store.pendingCount(), oldestPendingAt: store.oldestPendingAt() };
}

type Send = (report: SyncDeviceReport) => Promise<unknown>;

const sendToServer: Send = (report) => serverTrpcClient().sync.reportDevice.mutate(report);

/** Skicka rapporten; ett fel sväljs (nästa synk försöker igen). */
export async function reportSyncDevice(store: ReportableStore, userAgent: string, send: Send = sendToServer): Promise<void> {
  try {
    await send(buildDeviceReport(store, userAgent));
  } catch {
    // Bäst-möjligt: rapporten får aldrig fälla synken.
  }
}
