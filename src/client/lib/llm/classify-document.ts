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

import type { ILlmExtractor } from "@/server/llm/llm-extractor";

export const KNOWN_KINDS = [
  "STAMNING",
  "DOM",
  "BEVIS",
  "FULLMAKT",
  "AVTAL",
  "FAKTURA",
  "RAPPORT",
  "OKLASSIFICERAT",
] as const;
export type DocumentKind = (typeof KNOWN_KINDS)[number];

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

export function guessFromFilename(name: string): DocumentKind {
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
