"use client";

/**
 * `MergeConflictPanel` — visas när git_pull returnerar "merge-needed".
 *
 * Listar konfliktade filer + öppnar var och en i OS:ets default-app
 * (Preview/PDFGear för PDF, VS Code/TextEdit för text). Användaren
 * löser manuellt och pushar sen via huvud-panelen.
 *
 * Designval (v1): vi gör inte själva auto-merge. Att lösa konflikter
 * är jobb för en riktig editor — vi visar bara vad som krockar.
 */

import { useEffect, useState } from "react";
import type { ConflictedFile } from "@/lib/tauri/bridge";

interface Props {
  repoPath: string;
  onDismiss: () => void;
}

const KIND_LABELS: Record<string, string> = {
  both_modified: "Båda har ändrat",
  both_added: "Båda har skapat",
  deleted_by_us: "Vi har raderat, motpart har ändrat",
  deleted_by_them: "Motpart har raderat, vi har ändrat",
  unknown: "Okänd typ",
};

export function MergeConflictPanel({ repoPath, onDismiss }: Props) {
  const [files, setFiles] = useState<ConflictedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const bridge = await import("@/lib/tauri/bridge");
        const list = await bridge.listConflictedFiles(repoPath);
        setFiles(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [repoPath]);

  const openFile = async (relPath: string) => {
    const bridge = await import("@/lib/tauri/bridge");
    const sep = repoPath.endsWith("/") ? "" : "/";
    await bridge.openInDefaultApp(`${repoPath}${sep}${relPath}`);
  };

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">Merge-konflikter — lösning krävs</h3>
          <p className="text-xs text-amber-800 mt-0.5">
            Pull hämtade ändringar som krockar med dina lokala. Öppna
            varje fil, ta bort konflikt-markörerna (&lt;&lt;&lt;&lt;&lt;&lt;&lt;, =======,
            &gt;&gt;&gt;&gt;&gt;&gt;&gt;), spara, och tryck sen &quot;Spara &amp; pusha&quot;.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-gray-500 hover:underline"
        >
          Dölj
        </button>
      </div>

      {loading && <p className="mt-2 text-xs text-amber-800">Hämtar konfliktlista…</p>}
      {error && <p className="mt-2 text-xs text-red-700">✗ {error}</p>}
      {!loading && !error && files.length === 0 && (
        <p className="mt-2 text-xs text-amber-800">Inga konflikter hittade — kan vara löst nu.</p>
      )}

      {files.length > 0 && (
        <ul className="mt-3 border-t border-amber-200 pt-3 text-xs space-y-2">
          {files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-amber-900 truncate">{f.path}</p>
                <p className="text-amber-700 text-[10px]">{KIND_LABELS[f.kind] ?? f.kind}</p>
              </div>
              <button
                type="button"
                onClick={() => void openFile(f.path)}
                className="px-2 py-1 text-xs bg-white border border-amber-300 text-amber-900 rounded hover:bg-amber-100 shrink-0"
              >
                Öppna
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
