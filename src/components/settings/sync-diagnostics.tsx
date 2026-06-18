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

import { RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { loadHandle } from "@/lib/client/fsa/handle-store";
import { useSyncContext } from "@/lib/client/sync/sync-context";
import type { SyncState } from "@/lib/client/sync/use-auto-sync";
import { pluralChanges } from "@/lib/client/utils";

/** Meddelandet när ingen sync-provider finns (demo-läge eller saknad token/
 *  mapp). Utbruten ur SyncDiagnostics så dess två ternarier inte räknas in. */
function NoProviderNotice({ tier, folderName }: { tier: string | null; folderName: string | null }) {
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

/** "Synka nu"-knappen. Utbruten så dess `||`/ternarier inte räknas in i
 *  SyncDiagnostics-komponentens komplexitet. */
function SyncNowButton({ enabled, running, state, onTrigger }: {
  enabled: boolean; running: boolean; state: SyncState; onTrigger: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTrigger}
      disabled={!enabled || running || state.kind === "syncing"}
      title={!enabled ? "Sync inaktiv — kräver write-mode-token" : undefined}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
    >
      <RefreshCw size={14} className={running ? "animate-spin" : ""} />
      {running ? "Synkar…" : "Synka nu"}
    </button>
  );
}

export function SyncDiagnostics() {
  const { state, syncNow, providerKind, lastError, enabled } = useSyncContext();
  const [running, setRunning] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTier(loadFirmaConfig().tier);
    void loadHandle("repo-root").then((h) => setFolderName(h?.name ?? null));
  }, []);

  // Förfina meddelandet: i demo-mode är det INTE en konfig-fel utan ett
  // medvetet val (data hämtas från GH Pages, ändringar persisteras bara i
  // tab:en). Visa rätt förklaring per tier + redan-valda fakta.
  if (!providerKind) {
    return <NoProviderNotice tier={tier} folderName={folderName} />;
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
          {!enabled && (
            <p className="text-xs text-amber-700 mt-1">
              ⚠ Sync är inaktiv — du är troligen i demo-läge (anonym) eller
              har inte loggat in med en write-mode-token. &quot;Synka nu&quot; gör
              ingenting tills detta är åtgärdat.
            </p>
          )}
        </div>
        <SyncNowButton enabled={enabled} running={running} state={state} onTrigger={() => void trigger()} />
      </div>

      {lastError && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded p-3">
          <p className="text-xs font-semibold text-red-900 mb-1">Senaste fel</p>
          <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
            {lastError}
          </pre>
          <p className="text-xs text-red-700 mt-2">
            <strong>Vanliga orsaker:</strong> servern är inte nåbar, utloggad
            session (logga in på nytt), eller tillfälligt nätverksavbrott.
          </p>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Synk: server-first (tRPC mot servern); offline-ändringar synkas när du är online igen.
      </p>
    </div>
  );
}

type SyncKind = SyncState["kind"];
type SyncVariant<K extends SyncKind> = Extract<SyncState, { kind: K }>;

/**
 * En renderare per sync-läge. Uppslag i st.f. en 7-grenars switch håller
 * `StateLabel` under complexity@8 (#6-ratchet) — den mappade typen ger varje
 * renderare den smalnade varianten (t.ex. `synced` får `.at`, `pending` `.count`).
 */
const LABEL_RENDERERS: { [K in SyncKind]: (s: SyncVariant<K>) => ReactNode } = {
  idle: () => <>Väntar på första synk…</>,
  synced: (s) => <>✓ Allt sparat — senast {new Date(s.at).toLocaleTimeString("sv-SE")}</>,
  syncing: (s) => <>↻ {s.what === "pull" ? "Hämtar uppdateringar…" : "Sparar ändringar…"}</>,
  pending: (s) => <>⏳ {s.count} {pluralChanges(s.count)} — sparas inom kort</>,
  offline: (s) => <>⚠ Off-line — {s.count} {pluralChanges(s.count)} sparas lokalt</>,
  "merge-needed": () => <>⚠ Konflikt — behöver lösas manuellt</>,
  error: () => <>✗ Synk misslyckades — försöker igen automatiskt</>,
};

export function StateLabel({ state }: { state: SyncState }) {
  // Uppslaget kan inte korreleras med `state`:s variant av TS → en lokal cast.
  const render = LABEL_RENDERERS[state.kind] as (s: SyncState) => ReactNode;
  return <>{render(state)}</>;
}
