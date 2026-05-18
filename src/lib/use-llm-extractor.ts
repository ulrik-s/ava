/**
 * `useLlmExtractor` — React-hook som kapslar in en `ILlmExtractor`.
 *
 * Designval (DRY):
 *   - Samma state-pattern som useDemoRuntime/usePasskey
 *     (idle/working/ready/error). Konsumenter lär sig det en gång.
 *
 * Designval (DI):
 *   - `extractorFactory` propas in. UI:t kan starta utan att tvinga
 *     en download — användaren klickar "Aktivera lokal AI" och
 *     warmup() laddar modellen.
 */

"use client";

import { useCallback, useState } from "react";
import type {
  ILlmExtractor,
  ExtractionSchema,
  ExtractionResult,
} from "@/server/llm/llm-extractor";

export type ExtractorStatus = "idle" | "warming" | "ready" | "extracting" | "error";

export interface ExtractorState {
  status: ExtractorStatus;
  isReady: boolean;
  error: Error | null;
  warmup: () => Promise<void>;
  extract: (text: string, schema: ExtractionSchema) => Promise<ExtractionResult>;
}

export function useLlmExtractor(extractorFactory: () => ILlmExtractor): ExtractorState {
  // Lazy init via useState så factory bara körs en gång per
  // komponent-instans.
  const [extractor] = useState<ILlmExtractor>(extractorFactory);
  const [status, setStatus] = useState<ExtractorStatus>(extractor.isReady() ? "ready" : "idle");
  const [error, setError] = useState<Error | null>(null);

  const warmup = useCallback(async () => {
    setError(null);
    setStatus("warming");
    try {
      await extractor.warmup();
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, [extractor]);

  const extract = useCallback(async (text: string, schema: ExtractionSchema) => {
    setError(null);
    setStatus("extracting");
    try {
      const result = await extractor.extract(text, schema);
      setStatus("ready");
      return result;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, [extractor]);

  return {
    status,
    isReady: extractor.isReady(),
    error,
    warmup,
    extract,
  };
}
