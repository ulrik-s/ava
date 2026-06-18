"use client";

/**
 * `DatasourceSection` — visas på /settings och låter användaren välja
 * datakälla (demo / self-hosted) + se inloggningsstatus. Det här är
 * en *engångskonfiguration* — när det är gjort sker all sync
 * automatiskt i bakgrunden (se `AutoSync`).
 */

import { Database } from "lucide-react";
import { useEffect, useState } from "react";
import { signOutLocally } from "@/components/shell/sidebar";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { trpc } from "@/lib/client/trpc";
import { FirmaSettingsPanel } from "./firma-settings-panel";
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
        Self-hosted: din byrås data ligger på er server (Postgres) som du loggar
        in på via OIDC. Klienten är offline-first — ändringar sparas lokalt och
        synkas automatiskt mot servern när du är online. Demon kör utan server.
      </p>
      <FirmaSettingsPanel
        initial={config}
        onSaved={() => window.location.reload()}
        onCancel={() => { /* inline-vy — ingen cancel */ }}
        inline
      >
        {/* Inloggningsstatus + sync-status renderas FÖRE Spara-knappen så
            "Spara" hamnar allra längst ner i panelen. */}
        <LoginStatus />
        <SyncDiagnostics />
      </FirmaSettingsPanel>
    </div>
  );
}

/** Vem är inloggad? Läser `user.current` (in-process för demo, HTTP för
 *  self-hosted) + erbjuder utloggning (rensar lokal session → /login). */
export function LoginStatus() {
  const me = trpc.user.current.useQuery(undefined, { retry: false });

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <span className="text-xs text-gray-500 block mb-1">Inloggning</span>
      {me.isLoading ? (
        <p className="text-xs text-gray-400">Kollar inloggning…</p>
      ) : me.data ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-700">
            Inloggad som <span className="font-medium">{me.data.name}</span>{" "}
            <span className="text-gray-400">({me.data.email})</span>
          </p>
          <button
            type="button"
            onClick={() => signOutLocally()}
            className="text-xs text-red-600 hover:underline shrink-0"
          >
            Logga ut
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-400">Inte inloggad.</p>
      )}
    </div>
  );
}
