"use client";

/**
 * Bevakningen i Att bevaka för admin (#1267): enheter där en ändring fastnat
 * i webbläsaren eller som slutat synka.
 */

import Link from "next/link";
import { useState } from "react";
import { useSyncDevices } from "@/lib/client/backend/sync-devices";
import { devicesNeedingAttention } from "@/lib/shared/sync/device-health";

export function StaleDevicesNotice({ now }: { now?: number }) {
  const [openedAt] = useState(() => Date.now());
  const devices = useSyncDevices();
  const count = devicesNeedingAttention(devices.data ?? [], now ?? openedAt).length;
  if (count === 0) return null;
  return (
    <Link href="/sync-devices" data-testid="stale-devices-notice"
      className="mb-4 block rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900 hover:bg-red-100">
      ⚠ {count === 1 ? "1 enhet" : `${count} enheter`} har ändringar som inte nått servern på länge, eller har slutat synka. Se Enheter och synk.
    </Link>
  );
}
