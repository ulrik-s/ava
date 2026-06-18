"use client";

/**
 * `classifyDocument` — pure-ish helper för att klassificera ett juridiskt
 * dokument till en av AVA:s kategorier (STAMNING, DOM, BEVIS, …).
 *
 * Två strategier i hierarkisk fall-back:
 *   1. **LLM** — om `extractor.isReady()` och text finns. Skickar dokument-
 *      texten + en kort kategori-lista och låter modellen välja.
 *   2. **Heuristik** — regex mot filnamn. Snabbt och deterministiskt; finns
 *      alltid som fallback om LLM:n är av/inte klar/svarar med skräp.
 *
 * Designval: pure + injicerbar `extractor` så vi inte behöver mocka
 * importer i tester. Den-som-ringer äger valet av extractor.
 */

import type { ILlmExtractor } from "@/lib/server/llm/llm-extractor";
import { KNOWN_KINDS, type DocumentKind, guessFromFilename } from "@/lib/shared/document-kind";

// Kategorierna + filnamns-heuristiken bor numera i `lib/shared/document-kind`
// (delas med server-jobbet, #518). Re-exporteras så befintliga importörer
// (register-workers m.fl.) fortsätter peka hit.
export { KNOWN_KINDS, guessFromFilename };
export type { DocumentKind };

export interface ClassifyInput {
  fileName: string;
  text?: string;
  extractor?: ILlmExtractor;
}

export async function classifyDocument(input: ClassifyInput): Promise<DocumentKind> {
  const heuristic = guessFromFilename(input.fileName);
  // LLM-grenen kräver att extractor:n är på + att vi har text att jobba med
  if (input.extractor?.isReady() && input.text && input.text.trim().length > 50) {
    try {
      const result = await input.extractor.extract(input.text, {
        kind: {
          type: "string",
          description: `Dokumentets kategori. Välj EN av: ${KNOWN_KINDS.join(", ")}. Använd OKLASSIFICERAT om ingen passar.`,
        },
      });
      const raw = String(result.kind ?? "").trim().toUpperCase();
      const matched = (KNOWN_KINDS as readonly string[]).find((k) => k === raw);
      if (matched) return matched as DocumentKind;
    } catch {
      // LLM kraschade — falla tillbaka tyst på heuristik
    }
  }
  return heuristic;
}
