"use client";

/**
 * `HelperSection` — visar AVA Helper-status i Inställningar.
 *
 * Helpern är en liten localhost-app som möjliggör 1-klicks-öppning av
 * dokument i externa editorer (PDF Gear, Word, …). Detta UI visar
 * användaren om helpern är installerad och kör.
 */

import { ExternalLink, CheckCircle2, XCircle, Loader2, CloudUpload, AlertTriangle, CloudCheck, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useHelper, useHelperSyncStatus, triggerHelperUpdateCheck } from "@/lib/client/helper/use-helper";

const GUIDE_URL = "https://github.com/ulrik-s/ava/blob/main/docs/helper-installation.md";

export function HelperSection() {
  const status = useHelper();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold text-gray-900">AVA Helper</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Liten app på din Mac som öppnar PDF/Word-dokument direkt i dina vanliga
        program (Word, PDF Gear, Förhandsvisning…) och skickar tillbaka
        ändringarna till AVA när du sparar. Installeras en gång. Öppna
        AVA Helper (t.ex. via Spotlight) så visas ett fönster med status — där
        finns knappen <strong>Uppdatera nu</strong> när en ny version kommer.
      </p>

      <Status status={status} />
      {status.version ? <SyncStatus /> : null}
      {status.checked && !status.version ? <MacInstall /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <a href={GUIDE_URL} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          <ExternalLink size={14} /> Installationsguide
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

/** Terminal-raden som installerar helpern på macOS (public/helper/install.sh). */
export function macInstallCommand(origin: string): string {
  return `curl -fsSL ${origin}/helper/install.sh | bash`;
}

/**
 * Installation på Mac med en rad i Terminal. Appen är inte signerad av Apple
 * än; hämtad med curl stoppas den inte av Gatekeeper (docs/helper-installation.md).
 */
function MacInstall() {
  const [copied, setCopied] = useState(false);
  const command = macInstallCommand(window.location.origin);
  const copy = (): void => {
    void navigator.clipboard.writeText(command).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm">
      <p className="font-medium text-gray-900 mb-2">Installera på Mac</p>
      <ol className="list-decimal pl-5 space-y-1 text-gray-700 mb-3">
        <li>Klicka på <strong>Kopiera</strong> nedan.</li>
        <li>Tryck <kbd className="font-mono bg-white border rounded px-1">⌘ mellanslag</kbd>, skriv <strong>Terminal</strong> och tryck Enter.</li>
        <li>Klistra in (<kbd className="font-mono bg-white border rounded px-1">⌘ V</kbd>) och tryck Enter.</li>
        <li>Godkänn med ditt Mac-lösenord när macOS frågar om AVA:s certifikat.</li>
      </ol>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate font-mono text-xs bg-white border border-gray-200 rounded px-2 py-1.5">{command}</code>
        <button type="button" onClick={copy}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Kopierat" : "Kopiera"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">Klar på under en minut. AVA Helper öppnar ett statusfönster när den är installerad, och den här rutan försvinner.</p>
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
      <span className="text-gray-700">Inte installerad — behövs för att öppna dokument i Word/PDF-program och för Outlook-tillägget.</span>
    </div>
  );
}
