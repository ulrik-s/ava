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

/**
 * Mirror-to-Outlook-jobbets payload. Hela event-snapshot:n skickas med
 * (workern behöver inte refetcha från dataStore) plus operationen att
 * utföra: upsert eller delete.
 */
interface MirrorPayload extends Record<string, unknown> {
  eventId: string;
  op: "upsert" | "delete";
  /** Krävs för upsert; ignoreras för delete. */
  event?: {
    title: string;
    description?: string | null;
    location?: string | null;
    startAt: string;
    endAt?: string | null;
    allDay: boolean;
    visibility: "normal" | "private";
    kind: "appointment" | "deadline";
  };
  /** Sätts efter första lyckad mirror; för PATCH/DELETE krävs den. */
  outlookEventId?: string | null;
  outlookCalendarId?: string | null;
}

/** Graph-anrops-opts: token + (valfritt) calendarId när payload har det. */
function graphOpts(token: string, payload: MirrorPayload): { token: string; calendarId?: string } {
  return { token, ...(payload.outlookCalendarId != null ? { calendarId: payload.outlookCalendarId } : {}) };
}

jobQueue.registerWorker<MirrorPayload>("mirror-to-outlook", async (payload, ctx) => {
  ctx.setProgress(0.1);
  const { getOutlookToken, dispatchMirrorState } = await import("./mirror-outlook-dispatch");
  const token = await getOutlookToken();
  if (!token) {
    await dispatchMirrorState({
      eventId: payload.eventId,
      patch: { mirrorStatus: "failed", mirrorError: "Office 365 är inte ansluten. Anslut via /profile." },
      signal: ctx.signal,
    });
    return;
  }

  ctx.setProgress(0.4);
  const graph = await import("@/lib/client/integrations/microsoft-graph");
  try {
    if (payload.op === "delete") {
      if (payload.outlookEventId) {
        await graph.deleteGraphEvent(payload.outlookEventId, graphOpts(token, payload));
      }
      // Vid delete på AVA-eventet finns ingen rad att uppdatera — workern
      // slutar bara här. (Calendar-routerns delete tar bort raden helt.)
      ctx.setProgress(1);
      return;
    }
    // Upsert
    if (!payload.event) throw new Error("MirrorPayload saknar event-data för upsert");
    const body = graph.toGraphEvent({ ...payload.event });
    let outlookEventId: string;
    if (payload.outlookEventId) {
      const res = await graph.updateGraphEvent(payload.outlookEventId, body, graphOpts(token, payload));
      outlookEventId = res.id;
    } else {
      const res = await graph.createGraphEvent(body, graphOpts(token, payload));
      outlookEventId = res.id;
    }
    ctx.setProgress(0.9);
    await dispatchMirrorState({
      eventId: payload.eventId,
      patch: {
        outlookEventId,
        mirrorStatus: "synced",
        mirrorError: null,
        mirrorLastSyncedAt: new Date(),
      },
      signal: ctx.signal,
    });
    ctx.setProgress(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await dispatchMirrorState({
      eventId: payload.eventId,
      patch: { mirrorStatus: "failed", mirrorError: msg },
      signal: ctx.signal,
    });
    throw err;
  }
});

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
});

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
});

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Aborted");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("Aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
