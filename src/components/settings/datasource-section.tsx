"use client";

/**
 * `DatasourceSection` — visas på /settings och låter användaren välja
 * datakälla (demo / GitHub / self-hosted) + logga in/ut. Det här är
 * en *engångskonfiguration* — när det är gjort sker all sync
 * automatiskt i bakgrunden (se `AutoSync`).
 */

import { Database } from "lucide-react";
import { useEffect, useState } from "react";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { FirmaSettingsPanel } from "./firma-settings-panel";
import { FsaFolderSelector } from "./fsa-folder-selector";
import { SyncDiagnostics } from "./sync-diagnostics";

export function DatasourceSection() {
  const [config, setConfig] = useState<FirmaConfig | null>(null);

  // loadFirmaConfig läser localStorage → undvik SSR-mismatch
  useEffect(() => {
    queueMicrotask(() => setConfig(loadFirmaConfig()));
  }, []);

  if (!config) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <div className="text-xs text-gray-400">Laddar datakälla…</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-900">Datakälla & inloggning</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        AVA är multi-tenant via git — varje firma har sin egen repo som
        källa till all data. Konfigurera en gång; appen synkar därefter
        automatiskt i bakgrunden.
      </p>
      <FirmaSettingsPanel
        initial={config}
        onSaved={() => window.location.reload()}
        onCancel={() => { /* inline-vy — ingen cancel */ }}
        inline
      >
        {/* FSA-väljare + sync-status renderas FÖRE Spara-knappen så
            "Spara" hamnar allra längst ner i panelen. */}
        <div className="mt-4">
          <FsaFolderSelector repoUrl={config.repo} token={config.token} />
        </div>
        <SyncDiagnostics />
      </FirmaSettingsPanel>
    </div>
  );
}
