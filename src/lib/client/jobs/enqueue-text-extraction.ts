"use client";

/**
 * Köa `extract-text` för ett dokument (#988).
 *
 * Texten workern producerar gör två saker: den gör innehållet sökbart, och den
 * är det ENDA `document.suggestFromText` har att gå på i klient-tier:erna —
 * i demo och self-hosted når dokumentets bytes aldrig servern. Utan det här
 * steget fylls `SuggestionsPanel`/`EventsPanel` aldrig.
 *
 * Egen modul för att uppladdningen och "Analysera (AI)" ska köa jobbet på
 * exakt samma sätt: båda betyder "läs om det här dokumentet". Analyze-porten
 * (`document.analyze`) köar bara klassificeringen och känner varken filnamn
 * eller sökväg — de finns bara på klienten, i dokumentraden.
 */

/** Dokument-fälten workern behöver för att hitta och tolka filen. */
export interface ExtractableDoc {
  id: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
}

/** Köar jobbet. `undefined` (dokumentet hittades inte i vyn) → tyst no-op. */
export async function enqueueTextExtraction(doc: ExtractableDoc | undefined): Promise<void> {
  if (!doc) return;
  const { jobQueue } = await import("./job-queue");
  jobQueue.enqueue("extract-text", `Extraherar text ur ${doc.fileName}`, {
    documentId: doc.id,
    fileName: doc.fileName,
    storagePath: doc.storagePath,
    mimeType: doc.mimeType,
  });
}
