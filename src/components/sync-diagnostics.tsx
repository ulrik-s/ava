"use client";

/**
 * `SyncDiagnostics` — visar synk-status, senaste fel och en
 * "Synka nu"-knapp. Mountas på /settings under DatasourceSection.
 *
 * Surfacing av fel:
 *   - Nuvarande state (Sparat / Sparar / Off-line / Synk-fel)
 *   - Senaste error-meddelande (även när vi är i "syncing" eller
 *     "synced" senare — så user ser vad som hänt)
 *   - "Synka nu" → triggar manuell sync
 */

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSyncContext } from "@/lib/sync/sync-context";
import type { SyncState } from "@/lib/sync/use-auto-sync";

export function SyncDiagnostics() {
  const { state, syncNow, providerKind, lastError } = useSyncContext();
  const [running, setRunning] = useState(false);

  if (!providerKind) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600 mt-4">
        <strong className="text-gray-800">Synk:</strong> ingen lokal mapp vald
        eller token saknas. Konfigurera datakälla ovan så börjar
        auto-sync.
      </div>
    );
  }

  const trigger = async () => {
    setRunning(true);
    try { await syncNow(); }
    finally { setRunning(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Synkstatus</h3>
          <p className="text-xs text-gray-600 mt-1">
            <StateLabel state={state} />
          </p>
        </div>
        <button
          type="button"
          onClick={() => void trigger()}
          disabled={running || state.kind === "syncing"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
        >
          <RefreshCw size={14} className={running ? "animate-spin" : ""} />
          {running ? "Synkar…" : "Synka nu"}
        </button>
      </div>

      {lastError && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded p-3">
          <p className="text-xs font-semibold text-red-900 mb-1">Senaste fel</p>
          <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
            {lastError}
          </pre>
          <p className="text-xs text-red-700 mt-2">
            <strong>Vanliga orsaker:</strong> ogiltig/utgången GitHub-token,
            ingen läs- eller skrivbehörighet på repo:t, eller fel branch.
            Kolla datakälla-fältet ovan.
          </p>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Miljö: {providerKind === "tauri" ? "Tauri (libgit2)" : "Web FSA (isomorphic-git)"}
      </p>
    </div>
  );
}

function StateLabel({ state }: { state: SyncState }) {
  switch (state.kind) {
    case "idle":           return <>Vänlar på första synk…</>;
    case "synced":         return <>✓ Allt sparat — senast {new Date(state.at).toLocaleTimeString("sv-SE")}</>;
    case "syncing":        return <>↻ {state.what === "pull" ? "Hämtar uppdateringar…" : "Sparar ändringar…"}</>;
    case "pending":        return <>⏳ {state.count} ändring{state.count === 1 ? "" : "ar"} — sparas inom kort</>;
    case "offline":        return <>⚠ Off-line — {state.count} ändring{state.count === 1 ? "" : "ar"} sparas lokalt</>;
    case "merge-needed":   return <>⚠ Konflikt — behöver lösas manuellt</>;
    case "error":          return <>✗ Synk misslyckades — försöker igen automatiskt</>;
  }
}
