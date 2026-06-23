"use client";

/**
 * `analyze-dispatch` — global bridge mellan jobb-worker:n (som körs
 * utanför React-trädet) och tRPC-mutationen som skriver tillbaka
 * metadata.
 *
 * En React-komponent (`AnalyzeDispatcherRegistrar`) registrerar sin
 * `updateMetadata.mutateAsync`-callback via `setAnalyzeDispatcher()`
 * vid mount. Workern kallar `dispatchAnalyze()`.
 */

import type { DocumentAnalysisStatus } from "@/lib/shared/schemas/document";

export interface AnalyzeArgs {
  documentId: string;
  kind: string;
  /** ISO-timestamp när analysen körde. UI:n förlitar sig på detta
   *  för att stänga "⏳ analyseras..."-state:n. */
  analyzedAt?: string;
  /** Sätts av workern (i praktiken "DONE"). UI:n inspekterar fältet. */
  analysisStatus?: DocumentAnalysisStatus;
  signal?: AbortSignal;
}

type Dispatcher = (args: AnalyzeArgs) => Promise<void>;

let dispatcher: Dispatcher | null = null;

export function setAnalyzeDispatcher(fn: Dispatcher | null): void {
  dispatcher = fn;
}

export async function dispatchAnalyze(args: AnalyzeArgs): Promise<void> {
  if (!dispatcher) {
    throw new Error(
      "Ingen analyze-dispatcher registrerad — kontrollera att <AnalyzeDispatcherRegistrar> är mounted i trädet",
    );
  }
  if (args.signal?.aborted) throw new Error("Aborted");
  await dispatcher(args);
}
