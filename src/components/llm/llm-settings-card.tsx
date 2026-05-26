"use client";

/**
 * `LlmSettingsCard` — toggle + modell-väljare + nedladdning för in-browser LLM.
 *
 * Användarflöde:
 *   1. Slå på toggle → spara enabled=true i localStorage
 *   2. Välj modell (eller behåll default 1B)
 *   3. Klicka "Ladda ner modell" → progress visas, ~700 MB - 2 GB
 *   4. När progress = 100 % används LLM:n av classify-document-jobbet
 */

import { useEffect, useState } from "react";
import { Brain, Download, Check, AlertTriangle, Loader2 } from "lucide-react";
import {
  isLlmEnabled, setLlmEnabled,
  getLlmModelId, setLlmModelId,
  LLM_MODELS, type LlmModelId,
} from "@/client/lib/llm/llm-config";
import { downloadActiveModel, subscribeLlmProgress, getActiveLlm } from "@/client/lib/llm/active-llm";

const MODEL_LABELS: Record<LlmModelId, string> = {
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": "Llama 3.2 1B — snabb, ~700 MB",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": "Llama 3.2 3B — bättre kvalitet, ~2 GB",
};

// eslint-disable-next-line complexity
export function LlmSettingsCard() {
  const [enabled, setEnabled] = useState(false);
  const [modelId, setModel] = useState<LlmModelId>("Llama-3.2-1B-Instruct-q4f16_1-MLC");
  const [progress, setProgress] = useState<{ progress: number; text: string }>({ progress: 0, text: "" });
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Init från localStorage (post-mount så SSR hydration matchar)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(isLlmEnabled());
     
    setModel(getLlmModelId());
     
    setReady(getActiveLlm().isReady());
  }, []);

  // Subscribe på progress-events
  useEffect(() => {
    return subscribeLlmProgress((p) => {
      setProgress(p);
      if (p.progress >= 1) setReady(true);
    });
  }, []);

  const onToggle = () => {
    const next = !enabled;
    setLlmEnabled(next);
    setEnabled(next);
    setReady(next ? getActiveLlm().isReady() : false);
  };

  const onChangeModel = (m: LlmModelId) => {
    setLlmModelId(m);
    setModel(m);
    setReady(false); // ny modell kräver ny nedladdning
  };

  const onDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      await downloadActiveModel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  const pct = Math.round(Math.max(0, progress.progress) * 100);

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Brain size={18} /> AI (lokal LLM)
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Kör en språkmodell direkt i din browser via WebGPU. Helt offline —
            inga dokument lämnar maskinen. Modellen laddas ner en gång (~700 MB).
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          role="switch"
          aria-checked={enabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${enabled ? "bg-blue-600" : "bg-gray-300"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      {enabled && (
        <>
          <label className="block text-xs text-gray-600 mb-1">Modell</label>
          <select
            value={modelId}
            onChange={(e) => onChangeModel(e.target.value as LlmModelId)}
            disabled={downloading}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm mb-3 disabled:opacity-50"
          >
            {LLM_MODELS.map((m) => (
              <option key={m} value={m}>{MODEL_LABELS[m]}</option>
            ))}
          </select>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {downloading ? "Laddar ner…" : ready ? "Ladda ner igen" : "Ladda ner modell"}
            </button>
            {ready && !downloading && (
              <span className="inline-flex items-center gap-1 text-sm text-green-700">
                <Check size={14} /> Klar att användas
              </span>
            )}
          </div>

          {downloading && (
            <div className="mt-3">
              <div className="h-2 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1 truncate">
                {pct}% — {progress.text || "Förbereder…"}
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 inline-flex items-center gap-1 text-xs text-red-600">
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
