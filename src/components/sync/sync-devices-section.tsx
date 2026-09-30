"use client";

/**
 * Enheter och synk (#1267): varje webbläsare som synkar mot servern, när den
 * senast synkade och vad som ligger kvar i dess kö. En enhet med en osynkad
 * ändring äldre än ett dygn, eller som inte synkat på en vecka, markeras.
 */

import { useState } from "react";
import { useForgetSyncDevice, useSyncDevices } from "@/lib/client/backend/sync-devices";
import { trpc } from "@/lib/client/trpc";
import { deviceHealth, type DeviceHealth, type SyncDevice } from "@/lib/shared/sync/device-health";

const HEALTH: Readonly<Record<DeviceHealth, { label: string; className: string }>> = {
  ok: { label: "OK", className: "bg-green-50 text-green-800 border-green-200" },
  stuck: { label: "Osynkat > 1 dygn", className: "bg-red-50 text-red-800 border-red-200" },
  silent: { label: "Ingen synk på en vecka", className: "bg-amber-50 text-amber-900 border-amber-200" },
};

const when = (ms: number): string => new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

function pendingText(d: SyncDevice): string {
  if (d.pendingCount === 0) return "Inget";
  const oldest = d.oldestPendingAt === null ? "" : ` (äldsta ${when(d.oldestPendingAt)})`;
  return `${d.pendingCount} ${d.pendingCount === 1 ? "ändring" : "ändringar"}${oldest}`;
}

function DeviceRow({ device, userName, now }: { device: SyncDevice; userName: string; now: number }) {
  const forget = useForgetSyncDevice();
  const health = HEALTH[deviceHealth(device, now)];
  return (
    <tr className="border-t border-gray-100" data-testid="sync-device-row">
      <td className="py-2 pr-3">{userName}</td>
      <td className="py-2 pr-3 text-gray-600">{device.label ?? "Okänd enhet"}</td>
      <td className="py-2 pr-3">{when(device.lastSeenAt)}</td>
      <td className="py-2 pr-3">{pendingText(device)}</td>
      <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded border ${health.className}`}>{health.label}</span></td>
      <td className="py-2 text-right">
        <button type="button" className="text-xs text-gray-500 hover:text-red-700" disabled={forget.isPending}
          onClick={() => { if (confirm("Glöm enheten? Den dyker upp igen om den synkar.")) forget.mutate(device.deviceId); }}>
          Glöm
        </button>
      </td>
    </tr>
  );
}

/** Tabellen; tom (null) när översikten inte visas här. */
export function SyncDevicesSection({ now }: { now?: number }) {
  const [openedAt] = useState(() => Date.now());
  const at = now ?? openedAt;
  const devices = useSyncDevices();
  const users = trpc.user.list.useQuery(undefined, { enabled: devices.isSuccess });
  if (!devices.data) return null;
  const names = new Map<string, string>((users.data?.users ?? []).map((u) => [u.id, u.name]));
  if (devices.data.length === 0) return <p className="text-sm text-gray-500">Ingen enhet har synkat än.</p>;
  return (
    <table className="w-full text-sm" data-testid="sync-devices">
      <thead className="text-left text-xs text-gray-500">
        <tr><th className="pb-1">Användare</th><th className="pb-1">Enhet</th><th className="pb-1">Senast synkad</th><th className="pb-1">Osynkat</th><th className="pb-1">Läge</th><th /></tr>
      </thead>
      <tbody>
        {devices.data.map((d) => <DeviceRow key={d.deviceId} device={d} userName={names.get(d.userId) ?? "Okänd användare"} now={at} />)}
      </tbody>
    </table>
  );
}
