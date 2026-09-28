"use client";

/**
 * `StorageStatus` (#1241) — på /settings: har webbläsaren lovat att behålla
 * AVA:s lokala data (osynkade ändringar, ärenden för offline-arbete)?
 */

import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { requestPersistentStorageOnce, type StoragePersistence } from "@/lib/client/storage/persistent-storage";

const VIEWS: Record<StoragePersistence, { label: string; detail: string; cls: string }> = {
  persisted: {
    label: "Beständig",
    detail: "Webbläsaren rensar inte AVA:s lokala data på egen hand.",
    cls: "text-green-800",
  },
  "not-persisted": {
    label: "Kan rensas av webbläsaren",
    detail: "Vid lagringsbrist eller efter en tids inaktivitet kan ändringar som inte nått servern försvinna — synka innan du stänger, eller installera AVA som app.",
    cls: "text-amber-800",
  },
  unsupported: {
    label: "Okänd",
    detail: "Webbläsaren stöder inte beständig lagring. Synka innan du stänger fliken.",
    cls: "text-gray-700",
  },
};

export function StorageStatus({ request = requestPersistentStorageOnce }: { request?: () => Promise<StoragePersistence> }) {
  const [persistence, setPersistence] = useState<StoragePersistence | null>(null);

  useEffect(() => {
    let active = true;
    void request().then((p) => { if (active) setPersistence(p); });
    return () => { active = false; };
  }, [request]);

  const view = persistence ? VIEWS[persistence] : null;
  return (
    <div className="mt-4 border-t border-gray-100 pt-4" data-testid="storage-status" data-persistence={persistence ?? "pending"}>
      <span className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
        <HardDrive size={12} aria-hidden /> Lagring på den här enheten
      </span>
      {view ? (
        <>
          <p className={`text-sm font-medium ${view.cls}`}>{view.label}</p>
          <p className="text-xs text-gray-500">{view.detail}</p>
        </>
      ) : (
        <p className="text-xs text-gray-400">Kontrollerar…</p>
      )}
    </div>
  );
}
