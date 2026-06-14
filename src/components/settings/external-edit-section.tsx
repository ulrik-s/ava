"use client";

/**
 * `ExternalEditSection` — visas på /settings. Förklarar "Editera externt"-
 * flödet, visar browser-kompatibilitet, och har en "Förladda alla dokument
 * lokalt"-knapp för demo-mode så user inte behöver vänta på lazy-download
 * varje gång hen öppnar en fil.
 */

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { isFsaSupported, loadHandle, ensureReadWrite } from "@/lib/client/fsa/handle-store";
import { preloadAllDocuments } from "@/lib/client/fsa/preload-documents";

interface PreloadState {
  phase: "idle" | "running" | "done";
  done: number;
  total: number;
  result?: { downloaded: number; skipped: number; failed: number };
  error?: string;
}

/** Resultat-/fel-rad efter en preload-körning (visas när phase === "done"). */
export function PreloadResult({ preload }: { preload: PreloadState }) {
  if (preload.phase !== "done") return null;
  if (preload.error) return <p className="mt-2 text-xs text-red-600">✗ {preload.error}</p>;
  if (!preload.result) return null;
  return (
    <p className="mt-2 text-xs text-gray-600">
      ✓ Klart — {preload.result.downloaded} nedladdade, {preload.result.skipped} fanns redan
      {preload.result.failed > 0 && `, ${preload.result.failed} misslyckades`}.
    </p>
  );
}

export function ExternalEditSection() {
  const supported = isFsaSupported();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [preload, setPreload] = useState<PreloadState>({ phase: "idle", done: 0, total: 0 });

  useEffect(() => {
    void (async () => {
      const h = await loadHandle("repo-root");
       
      setFolderName(h?.name ?? null);
    })();
  }, []);

  const baseUrl = (() => {
    const repo = process.env.NEXT_PUBLIC_DEMO_REPO || process.env.NEXT_PUBLIC_DEFAULT_DEMO_REPO || "ulrik-s/ava-demo";
    const m = repo.match(/^([^/\s]+)\/([^/\s]+)$/);
    return m ? `https://${m[1]}.github.io/${m[2]}` : repo;
  })();

  async function runPreload(): Promise<void> {
    const root = await loadHandle("repo-root");
    if (!root) { alert("Välj en lokal mapp först under 'Datakälla & inloggning'."); return; }
    if (!(await ensureReadWrite(root))) { alert("AVA fick inte tillåtelse att skriva i mappen."); return; }
    setPreload({ phase: "running", done: 0, total: 0 });
    try {
      const result = await preloadAllDocuments({
        root, baseUrl,
        onProgress: (done, total) => setPreload({ phase: "running", done, total }),
      });
      setPreload({ phase: "done", done: result.downloaded + result.skipped + result.failed, total: result.downloaded + result.skipped + result.failed, result });
    } catch (err) {
      setPreload({ phase: "done", done: 0, total: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Pencil size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-900">Editera dokument i extern app</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Klicka <strong>🖥 Editera externt</strong> på en dokumentrad → AVA pekar ut
        filen i din lokala mapp så du dubbelklickar den i Finder/Explorer och
        öppnar i <em>PDF Gear, Preview, Word</em> osv. När du sparar (Cmd+S)
        committar AVA en ny version automatiskt — efter 90 s utan nya
        sparningar, eller direkt via &quot;Spara nu&quot;-knappen i banner:n.
      </p>

      <div className="text-xs space-y-1 mb-4">
        <div>
          <strong>Browser-kompatibilitet:</strong>{" "}
          {supported
            ? <span className="text-green-700">✓ Stöds (Chrome/Edge/Opera/Brave)</span>
            : <span className="text-red-700">✗ Inte stöd i denna browser. Använd Chrome eller Edge på desktop.</span>}
        </div>
        <div>
          <strong>Vald lokal mapp:</strong>{" "}
          {folderName
            ? <code className="bg-gray-100 px-1 rounded">{folderName}/</code>
            : <span className="text-amber-700">Ingen mapp vald — gå till &quot;Datakälla & inloggning&quot; ovan och välj en.</span>}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void runPreload()}
        disabled={!supported || !folderName || preload.phase === "running"}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        title="Hämta alla seed-dokument från GH Pages och spara dem i din lokala mapp så de finns redo att öppna i extern app"
      >
        {preload.phase === "running" ? `Förladdar ${preload.done}/${preload.total}…` : "Förladda alla dokument lokalt"}
      </button>

      <PreloadResult preload={preload} />
    </div>
  );
}
