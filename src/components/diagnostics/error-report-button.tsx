"use client";

/**
 * `ErrorReportButton` — flytande "Rapportera fel"-knapp (nedre högra hörnet)
 * med en badge som visar antal självupptäckta fel. Öppnar en dialog där
 * användaren skriver en beskrivning och skickar iväg rapporten som en
 * GitHub-issue (prefill-länk) — se [[report]] för leverans-modellen.
 *
 * Lager 1 (självupptäckta fel) + lager 2 (console-logg) bifogas automatiskt;
 * användaren kan toggla bort loggen. All tung logik ligger i diagnostics/
 * index.ts (testad) — komponenten är tunn.
 */

import { Bug, X, Copy, ExternalLink, Check } from "lucide-react";
import { useState } from "react";
import { buildSessionIssueUrl, issueStore } from "@/lib/client/diagnostics";
import { useSelfDetectedIssues } from "@/lib/client/diagnostics/use-issues";

export function ErrorReportButton() {
  const [open, setOpen] = useState(false);
  const issues = useSelfDetectedIssues();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Rapportera fel"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg hover:bg-gray-700"
      >
        <Bug size={16} />
        Rapportera fel
        {issues.length > 0 && (
          <span
            aria-label={`${issues.length} självupptäckta fel`}
            className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold"
          >
            {issues.length}
          </span>
        )}
      </button>
      {open && <ErrorReportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ErrorReportDialog({ onClose }: { onClose: () => void }) {
  const issues = useSelfDetectedIssues();
  const [text, setText] = useState("");
  const [includeLogs, setIncludeLogs] = useState(true);
  const [copied, setCopied] = useState(false);

  const openGithub = (): void => {
    const { url } = buildSessionIssueUrl({ userText: text, includeLogs });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyReport = async (): Promise<void> => {
    const { report } = buildSessionIssueUrl({ userText: text, includeLogs });
    await navigator.clipboard?.writeText(`${report.title}\n\n${report.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Rapportera fel">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="font-semibold text-gray-900">Rapportera fel</h2>
          <button type="button" onClick={onClose} aria-label="Stäng" className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Vad hände?</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Beskriv vad du gjorde och vad som blev fel…"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <SelfDetectedList issues={issues} />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={includeLogs} onChange={(e) => setIncludeLogs(e.target.checked)} />
            Bifoga senaste konsol-logg
          </label>

          <p className="text-xs text-gray-500">
            Rapporten öppnas som en förifylld GitHub-issue — inget skickas
            automatiskt, du granskar och trycker själv på &quot;Submit&quot;.
            Undvik att inkludera känsliga klientuppgifter.
          </p>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          {issues.length > 0 && (
            <button type="button" onClick={() => issueStore.clear()} className="mr-auto text-xs text-gray-500 hover:text-gray-700">
              Rensa upptäckta fel
            </button>
          )}
          <button type="button" onClick={() => void copyReport()} className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Kopierad" : "Kopiera"}
          </button>
          <button type="button" onClick={openGithub} className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
            <ExternalLink size={15} />
            Öppna GitHub-issue
          </button>
        </footer>
      </div>
    </div>
  );
}

function SelfDetectedList({ issues }: { issues: ReadonlyArray<{ code: string; message: string }> }) {
  if (issues.length === 0) return null;
  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="mb-1 text-xs font-semibold uppercase text-amber-800">
        Självupptäckta fel ({issues.length})
      </div>
      <ul className="space-y-1 text-xs text-amber-900">
        {issues.map((v, i) => (
          <li key={`${v.code}-${i}`}>• {v.message}</li>
        ))}
      </ul>
    </div>
  );
}
