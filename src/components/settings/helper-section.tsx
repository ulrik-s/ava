"use client";

/**
 * `HelperSection` — visar AVA Helper-status i Inställningar.
 *
 * Helpern är en liten localhost-app som möjliggör 1-klicks-öppning av
 * dokument i externa editorer (PDF Gear, Word, …). Detta UI visar
 * användaren om helpern är installerad och kör.
 */

import { ExternalLink, CheckCircle2, XCircle, Loader2, CloudUpload, AlertTriangle, CloudCheck } from "lucide-react";
import { useHelper, useHelperSyncStatus, triggerHelperUpdateCheck } from "@/lib/client/helper/use-helper";

const RELEASES_URL = "https://github.com/ulrik-s/ava/releases?q=helper-&expanded=true";

export function HelperSection() {
  const status = useHelper();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold text-gray-900">AVA Helper</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Liten lokal-app som öppnar PDF/Word-dokument direkt i dina vanliga
        editorer (PDF Gear, Preview, Word…) och synkar tillbaka ändringar
        till AVA när du sparar. Installeras en gång — uppdaterar sig själv
        därefter dagligen.
      </p>

      <Status status={status} />
      {status.version ? <SyncStatus /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <a href={RELEASES_URL} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          <ExternalLink size={14} /> Ladda ner / installations-anvisningar
        </a>
        {status.version && (
          <button type="button"
            onClick={() => void triggerHelperUpdateCheck()}
            className="text-xs text-gray-500 hover:underline">
            Kolla efter uppdatering nu
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Synk-status för helperns durabla upload-kö (ADR 0028 §8): offline-sparningar
 * får ALDRIG vara osynliga. Visar konflikt > väntande > allt-synkat (i den
 * prioritetsordningen). Renderar inget innan första pollen / utan /status.
 */
function SyncStatus() {
  const sync = useHelperSyncStatus();
  if (sync === null) return null;
  if (sync.conflict > 0) {
    return (
      <div className="mt-2 inline-flex items-center gap-2 text-sm text-amber-700">
        <AlertTriangle size={14} />
        <span>{sync.conflict} dokument i konflikt — servern har en nyare version. Öppna och spara igen för att lösa.</span>
      </div>
    );
  }
  if (sync.pending > 0) {
    return (
      <div className="mt-2 inline-flex items-center gap-2 text-sm text-blue-700">
        <CloudUpload size={14} />
        <span>{sync.pending} {sync.pending === 1 ? "ändring väntar" : "ändringar väntar"} på synk — sparas så fort servern går att nå.</span>
      </div>
    );
  }
  return (
    <div className="mt-2 inline-flex items-center gap-2 text-sm text-green-700">
      <CloudCheck size={14} />
      <span>Allt synkat — inga väntande ändringar.</span>
    </div>
  );
}

function Status({ status }: { status: ReturnType<typeof useHelper> }) {
  if (!status.checked) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" /> Kontrollerar…
      </div>
    );
  }
  if (status.version) {
    return (
      <div className="inline-flex items-center gap-2 text-sm">
        <CheckCircle2 size={14} className="text-green-600" />
        <span>Installerad — version <code className="font-mono bg-gray-100 px-1 rounded">{status.version}</code></span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <XCircle size={14} className="text-amber-600" />
      <span className="text-gray-700">Inte installerad — PDF-redigering kräver det extra steg du har idag.</span>
    </div>
  );
}
