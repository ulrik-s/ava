"use client";

/**
 * `active-llm` — singleton accessor som returnerar rätt `ILlmExtractor`
 * baserat på config.
 *
 * Kontrakt:
 *   - Disabled (default) → returnerar `NoopExtractor` (kallande kod fungerar
 *     men får tomma resultat → faller tillbaka till heuristik).
 *   - Enabled + warmup OK → returnerar `WebLlmExtractor`.
 *   - Enabled + warmup pågår → returnerar singleton som svarar `isReady() = false`.
 *
 * `getActiveLlm()` startar inte warmup automatiskt — användaren måste klicka
 * "Ladda ner modell" i /settings. Detta skyddar mot oavsiktliga 1GB-fetches.
 */

import { NoopExtractor, type ILlmExtractor } from "@/lib/server/llm/llm-extractor";
import { isLlmEnabled, getLlmModelId } from "./llm-config";
import { WebLlmExtractor, type ProgressEvent } from "./web-llm-extractor";

let singleton: ILlmExtractor | null = null;
let singletonModel: string | null = null;
let lastProgress: ProgressEvent = { progress: 0, text: "" };
const progressListeners = new Set<(p: ProgressEvent) => void>();

function emitProgress(p: ProgressEvent): void {
  lastProgress = p;
  for (const fn of progressListeners) fn(p);
}

export function subscribeLlmProgress(fn: (p: ProgressEvent) => void): () => void {
  progressListeners.add(fn);
  fn(lastProgress);
  return () => { progressListeners.delete(fn); };
}

export function getLlmProgress(): ProgressEvent { return lastProgress; }

/**
 * Returnerar singleton extractor. Skapas lazy. Återskapas om model-id ändras.
 *
 * Default-state: Noop. När användaren slår på i settings + kör downloadModel()
 * byts singleton till WebLlmExtractor.
 */
export function getActiveLlm(): ILlmExtractor {
  if (!isLlmEnabled()) return new NoopExtractor();
  const wanted = getLlmModelId();
  if (!singleton || singletonModel !== wanted) {
    singleton = new WebLlmExtractor({
      modelId: wanted,
      onProgress: emitProgress,
    });
    singletonModel = wanted;
  }
  return singleton;
}

/**
 * Trigga modell-nedladdning + warmup. Kallas från /settings-knappen.
 * Returnerar Promise som resolves när modellen är klar att köra.
 */
export async function downloadActiveModel(): Promise<void> {
  if (!isLlmEnabled()) {
    throw new Error("LLM är inte aktiverad — slå på i inställningar först.");
  }
  const llm = getActiveLlm();
  emitProgress({ progress: 0, text: "Förbereder…" });
  await llm.warmup();
  emitProgress({ progress: 1, text: "Klar" });
}

/** För test/dev — släng singleton så nästa `getActiveLlm()` skapar ny. */
export function resetActiveLlm(): void {
  singleton = null;
  singletonModel = null;
  lastProgress = { progress: 0, text: "" };
}
