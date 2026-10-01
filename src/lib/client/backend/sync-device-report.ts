"use client";

/**
 * Rapportera enhetens synkläge till servern efter en synk (#1267): hur många
 * ändringar som ligger kvar, när den äldsta gjordes och — när synken
 * misslyckades — varför (#1353). Servern larmar admin när en ändring fastnat
 * i en webbläsare, eller när en enhet slutat synka. Rapporten skickas också
 * efter en misslyckad synk: annars skulle larmet "fast kö" aldrig gå.
 *
 * Bäst-möjligt: en rapport som inte kommer fram fäller aldrig synken — nästa
 * synk rapporterar igen.
 */

import { deviceId, deviceLabel } from "@/lib/client/sync/device-id";
import type { SyncDeviceReport } from "@/lib/shared/sync/device-health";
import { serverTrpcClient } from "./server-trpc-client";

/** Det rapporten läser ur storen. */
export interface ReportableStore {
  pendingCount(): number;
  oldestPendingAt(): number | null;
}

/** Enhetens rapport just nu; `lastError` är felet som stoppade synken (null = lyckad). */
export function buildDeviceReport(store: ReportableStore, userAgent: string, lastError: string | null, id: string = deviceId()): SyncDeviceReport {
  return { deviceId: id, label: deviceLabel(userAgent), pendingCount: store.pendingCount(), oldestPendingAt: store.oldestPendingAt(), lastError };
}

type Send = (report: SyncDeviceReport) => Promise<unknown>;

const sendToServer: Send = (report) => serverTrpcClient().sync.reportDevice.mutate(report);

/** Skicka rapporten; ett fel sväljs (nästa synk försöker igen). */
export async function reportSyncDevice(store: ReportableStore, userAgent: string, lastError: string | null, send: Send = sendToServer): Promise<void> {
  try {
    await send(buildDeviceReport(store, userAgent, lastError));
  } catch {
    // Bäst-möjligt: rapporten får aldrig fälla synken.
  }
}
