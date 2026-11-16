"use client";

/**
 * Registrera alla jobb-workers vid första import. Importeras
 * one-shot från `demo-bootstrap.tsx`.
 *
 * Just nu:
 *   - `classify-document` — sätter `kind` på ett dokument baserat på
 *     filename + ev. innehåll. Heuristik först; WebLLM senare.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { DocumentId } from "@/lib/shared/schemas/ids";
import { jobQueue, type JobKind } from "./job-queue";

/**
 * Tidsgräns per kind (#1286). Ett jobb som hänger (ett tRPC-anrop, en PDF
 * som inte går att tolka) avbryts, blir "failed" och släpper kön, i stället
 * för att blockera alla följande jobb av samma kind.
 *
 *   - classify-document: filnamnsheuristik och ett tRPC-anrop.
 *   - extract-text: stora PDF:er tar tid att tolka i webbläsaren.
 */
export const WORKER_TIMEOUTS_MS = {
  "classify-document": 60_000,
  "extract-text": 5 * 60_000,
} as const satisfies Partial<Record<JobKind, number>>;

interface ClassifyPayload extends Record<string, unknown> {
  documentId: DocumentId;
  fileName: string;
  storagePath?: string;
}

interface ExtractTextPayload extends Record<string, unknown> {
  documentId: DocumentId;
  fileName: string;
  storagePath: string;
  mimeType?: string;
}

jobQueue.registerWorker<ExtractTextPayload>("extract-text", async (payload, ctx) => {
  // Steg 1: hämta fil-bytes från FSA-handle
  ctx.setProgress(0.1);
  const { loadHandle, isFsaSupported } = await import("@/lib/client/fsa/handle-store");
  if (!isFsaSupported()) {
    console.warn("[extract-text] FSA stöds inte → hoppar över");
    return;
  }
  const handle = await loadHandle("repo-root");
  if (!handle) {
    console.warn("[extract-text] ingen FSA-mapp vald → hoppar över");
    return;
  }
  const parts = payload.storagePath.replace(/^\/+/, "").split("/");
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]!); }
    catch { console.warn("[extract-text] saknad katalog:", parts[i]); return; }
  }
  let fileHandle: FileSystemFileHandle;
  try { fileHandle = await dir.getFileHandle(parts[parts.length - 1]!); }
  catch { console.warn("[extract-text] saknad fil:", payload.storagePath); return; }
  const file = await fileHandle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Steg 2: extrahera text
  ctx.setProgress(0.4);
  const { extractText } = await import("@/lib/client/jobs/extract-text");
  const text = await extractText({ bytes, ...omitUndefined({ mimeType: payload.mimeType }), fileName: payload.fileName });

  // Steg 3: skriv till documents/text/<id>.txt och cache:a för sök
  ctx.setProgress(0.8);
  if (text.length > 0) {
    const { dispatchExtractText } = await import("./extract-text-dispatch");
    await dispatchExtractText({ documentId: payload.documentId, text, signal: ctx.signal });
    const { setDocumentContent } = await import("@/lib/client/demo/document-content-cache");
    setDocumentContent(payload.documentId, text);
  }
  ctx.setProgress(1);
}, { timeoutMs: WORKER_TIMEOUTS_MS["extract-text"] });

jobQueue.registerWorker<ClassifyPayload>("classify-document", async (payload, ctx) => {
  ctx.setProgress(0.1);
  await sleepWithAbort(50, ctx.signal);

  // Klient-LLM borttagen (#518 Fas 5): klassificering på klienten är ren,
  // deterministisk filnamns-heuristik. Text-baserad LLM-klassning sker
  // server-side via jobb-kön + ollama (self-hosted); demo/offline saknar
  // server-LLM och faller därför tillbaka på heuristiken här.
  const { guessFromFilename } = await import("@/lib/shared/document-kind");

  ctx.setProgress(0.3);
  const guess = guessFromFilename(payload.fileName);

  // Skriv `documentType` + `analyzedAt` + `analysisStatus` via tRPC.
  // Alla tre fält måste sättas så UI:n vet att analysen körts klart —
  // utan analyzedAt visas "⏳ analyseras..." permanent.
  ctx.setProgress(0.7);
  const { dispatchAnalyze } = await import("./analyze-dispatch");
  await dispatchAnalyze({
    documentId: payload.documentId,
    kind: guess,
    analyzedAt: new Date().toISOString(),
    analysisStatus: "DONE",
    signal: ctx.signal,
  });
  ctx.setProgress(1);
}, { timeoutMs: WORKER_TIMEOUTS_MS["classify-document"] });

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Aborted");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("Aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
