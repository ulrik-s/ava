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

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSyncContext } from "@/client/lib/sync/sync-context";
import type { SyncState } from "@/client/lib/sync/use-auto-sync";
import { loadFirmaConfig } from "@/client/lib/firma/firma-config";
import { loadHandle } from "@/client/lib/fsa/handle-store";

export function SyncDiagnostics() {
  const { state, syncNow, providerKind, lastError } = useSyncContext();
  const [running, setRunning] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTier(loadFirmaConfig().tier);
    void loadHandle("repo-root").then((h) => setFolderName(h?.name ?? null));
  }, []);

  if (!providerKind) {
    // Förfina meddelandet: i demo-mode är det INTE en konfig-fel utan
    // ett medvetet val (data hämtas från GH Pages, ändringar persisteras
    // bara i tab:en). Visa rätt förklaring per tier + redan-valda fakta.
    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-600 mt-4 space-y-1">
        <p>
          <strong className="text-gray-800">Synk:</strong>{" "}
          {tier === "demo"
            ? "demo-läge — ingen remote-sync. Ändringar lever bara i denna tab/mappen lokalt."
            : "auto-sync inaktiv — token för git-remote saknas, eller mapp ej vald."}
        </p>
        <p>
          <strong className="text-gray-800">Lokal mapp:</strong>{" "}
          {folderName
            ? <>vald (<code className="bg-gray-100 px-1 rounded">{folderName}/</code>)</>
            : "ingen mapp vald — välj under 'Datakälla' ovan."}
        </p>
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
        Miljö: Web FSA (isomorphic-git)
      </p>
    </div>
  );
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'StateLabel' has a complexity of 11. Maximum allowed is 8.)
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
