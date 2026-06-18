/**
 * Dokumentkategorier + filnamns-heuristik — delad mellan klient (web-llm-
 * klassificerare) och server (`classify-document`-jobbet, #518). Ren, inga
 * beroenden, så både `lib/client` och `lib/server` kan importera den.
 */

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

/**
 * Deterministisk fallback-klassificering ur filnamnet. Snabb och alltid
 * tillgänglig — används direkt (server-first Fas 2) och som fallback när
 * LLM:en är av/inte redo/svarar med skräp.
 */
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
