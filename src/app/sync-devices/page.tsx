"use client";

/** Enheter och synk (#1267) — adminens översikt över varje webbläsare som synkar. */

import { SyncDevicesSection } from "@/components/sync/sync-devices-section";
import { useCanSeeSyncDevices } from "@/lib/client/backend/sync-devices";

export default function SyncDevicesPage() {
  const canSee = useCanSeeSyncDevices();
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold mb-2">Enheter och synk</h1>
      <p className="text-sm text-gray-600 mb-4">
        Varje webbläsare som synkar mot servern. En ändring som legat kvar i en webbläsare mer än ett dygn, eller en
        enhet som inte synkat på en vecka, markeras — det arbetet finns bara där tills enheten synkar.
      </p>
      {canSee ? <SyncDevicesSection /> : <p className="text-sm text-gray-500">Översikten finns för administratörer när AVA körs mot en server.</p>}
    </div>
  );
}
