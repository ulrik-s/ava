"use client";

/**
 * `IntegrationsSection` — listar alla registrerade connectors på
 * /profile (när profil-vyn finns). Renderar status + connect/disconnect
 * generiskt så att nya connectors plugas in via registry:t utan
 * UI-ändring.
 *
 * Visas just nu på /settings under en "Anslutna tjänster"-rubrik som
 * placeholder; flyttas till /profile när användarmodellen är klar.
 */

import { Plug } from "lucide-react";
import { useEffect, useState } from "react";
import "@/lib/client/integrations/office365-connector"; // ⚠ side-effect: registrerar
import { listConnectors } from "@/lib/client/integrations/registry";
import type { ConnectionStatus, IntegrationConnector } from "@/lib/client/integrations/types";

export function IntegrationsSection() {
  const [connectors] = useState(() => listConnectors());

  if (connectors.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Plug size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-900">Anslutna tjänster</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Logga in mot externa tjänster för att läsa mejl, OneDrive-filer
        och kalender direkt i AVA. Dina åtkomst-tokens lagras endast på
        den här enheten — de sparas aldrig i firmans git-repo.
      </p>
      <ul className="space-y-3">
        {connectors.map((c) => <ConnectorRow key={c.id} connector={c} />)}
      </ul>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: IntegrationConnector }) {
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "disconnected" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => connector.subscribe(setStatus), [connector]);

  const onConnect = async () => {
    setBusy(true); setErr(null);
    try { await connector.connect(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const onDisconnect = async () => {
    setBusy(true); setErr(null);
    try { await connector.disconnect(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <li className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{connector.displayName}</span>
          <span className="text-[10px] text-gray-500">
            {connector.capabilities.join(" · ")}
          </span>
        </div>
        <p className="text-xs mt-1">
          <StatusLine status={status} />
        </p>
        {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      </div>
      <div className="shrink-0">
        {status.kind === "connected" ? (
          <button
            type="button"
            onClick={() => void onDisconnect()}
            disabled={busy}
            className="text-xs text-gray-500 hover:text-red-600 hover:underline disabled:opacity-50"
          >
            Koppla bort
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onConnect()}
            disabled={busy}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            {busy ? "Ansluter…" : "Anslut"}
          </button>
        )}
      </div>
    </li>
  );
}

function StatusLine({ status }: { status: ConnectionStatus }) {
  switch (status.kind) {
    case "disconnected": return <span className="text-gray-500">Ej ansluten</span>;
    case "connecting": return <span className="text-blue-600">Ansluter…</span>;
    case "connected": return <span className="text-green-700">✓ {status.account.email}</span>;
    case "expired": return <span className="text-amber-700">⚠ Token förfallit — anslut igen</span>;
    case "error": return <span className="text-red-700">✗ {status.message}</span>;
  }
}
