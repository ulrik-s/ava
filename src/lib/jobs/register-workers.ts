"use client";

/**
 * Registrera alla jobb-workers vid första import. Importeras
 * one-shot från `demo-bootstrap.tsx`.
 *
 * Just nu:
 *   - `classify-document` — sätter `kind` på ett dokument baserat på
 *     filename + ev. innehåll. Heuristik först; WebLLM senare.
 */

import { jobQueue } from "./job-queue";

interface ClassifyPayload extends Record<string, unknown> {
  documentId: string;
  fileName: string;
  storagePath?: string;
}

interface ExtractTextPayload extends Record<string, unknown> {
  documentId: string;
  fileName: string;
  storagePath: string;
  mimeType?: string;
}

jobQueue.registerWorker<ExtractTextPayload>("extract-text", async (payload, ctx) => {
  // Steg 1: hämta fil-bytes från FSA-handle
  ctx.setProgress(0.1);
  const { loadHandle, isFsaSupported } = await import("@/lib/fsa/handle-store");
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
    try { dir = await dir.getDirectoryHandle(parts[i]); }
    catch { console.warn("[extract-text] saknad katalog:", parts[i]); return; }
  }
  let fileHandle: FileSystemFileHandle;
  try { fileHandle = await dir.getFileHandle(parts[parts.length - 1]); }
  catch { console.warn("[extract-text] saknad fil:", payload.storagePath); return; }
  const file = await fileHandle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Steg 2: extrahera text
  ctx.setProgress(0.4);
  const { extractText } = await import("@/lib/text-extraction/extract");
  const text = await extractText({ bytes, mimeType: payload.mimeType, fileName: payload.fileName });

  // Steg 3: skriv till documents/text/<id>.txt och cache:a för sök
  ctx.setProgress(0.8);
  if (text.length > 0) {
    const { dispatchExtractText } = await import("./extract-text-dispatch");
    await dispatchExtractText({ documentId: payload.documentId, text, signal: ctx.signal });
    const { setDocumentContent } = await import("@/lib/search/document-content-cache");
    setDocumentContent(payload.documentId, text);
  }
  ctx.setProgress(1);
});

jobQueue.registerWorker<ClassifyPayload>("classify-document", async (payload, ctx) => {
  // Steg 1: snabb filename-heuristik
  ctx.setProgress(0.1);
  await sleepWithAbort(200, ctx.signal);
  const guess = guessFromFilename(payload.fileName);

  // Steg 2: skriv `documentType` + `analyzedAt` + `analysisStatus` via tRPC.
  // Alla tre fält måste sättas så UI:n vet att analysen körts klart —
  // utan analyzedAt visas "⏳ analyseras..." permanent.
  ctx.setProgress(0.5);
  const { dispatchAnalyze } = await import("./analyze-dispatch");
  await dispatchAnalyze({
    documentId: payload.documentId,
    kind: guess,
    analyzedAt: new Date().toISOString(),
    analysisStatus: "DONE",
    signal: ctx.signal,
  });
  ctx.setProgress(1);
});

function guessFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (/(stamning|kallelse|stämning)/.test(lower)) return "STAMNING";
  if (/(dom|beslut|tingsr|domstol)/.test(lower)) return "DOM";
  if (/(bevis|fotografi|bilaga|exhibit)/.test(lower)) return "BEVIS";
  if (/(fullmakt|poa|power)/.test(lower)) return "FULLMAKT";
  if (/(avtal|kontrakt|hyres|köpe|köpeavtal)/.test(lower)) return "AVTAL";
  if (/(faktura|invoice|kvitto|receipt)/.test(lower)) return "FAKTURA";
  if (/(rapport|utlatande|utlåtande|expert)/.test(lower)) return "RAPPORT";
  return "OKLASSIFICERAT";
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Aborted");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("Aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
