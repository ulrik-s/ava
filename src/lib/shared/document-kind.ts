/**
 * Dokumentkategorier + filnamns-heuristik — delad mellan klient (web-llm-
 * klassificerare) och server (`classify-document`-jobbet, #518). Ren, inga
 * beroenden, så både `lib/client` och `lib/server` kan importera den.
 */

export const KNOWN_KINDS = [
  "STAMNING",
  "KALLELSE",
  "INLAGA",
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
 * Vad varje kategori betyder, i klartext — för LLM-prompten (#1156). De nakna
 * koderna räckte inte för en liten modell: `STAMNING` (utan ä) kändes inte
 * igen i en "STÄMNINGSANSÖKAN". Mätt på ava-crm.io-servern med qwen2.5: 4–5/7
 * rätt med bara koder, 6/7 med beskrivningarna.
 */
export const KIND_DESCRIPTIONS: Readonly<Record<DocumentKind, string>> = {
  STAMNING: "stämningsansökan, ansökan om stämning",
  KALLELSE: "kallelse till förhandling, sammanträde eller huvudförhandling",
  INLAGA: "inlaga eller skrift till domstol eller myndighet: yttrande, svaromål, överklagande, bemötande",
  DOM: "dom eller beslut från domstol eller myndighet (domslut, domskäl)",
  BEVIS: "bevisning, bilaga, fotografi, intyg som åberopas som bevis",
  FULLMAKT: "fullmakt att företräda någon",
  AVTAL: "avtal, kontrakt, hyresavtal, köpeavtal, överenskommelse",
  FAKTURA: "faktura, kvitto, räkning med belopp att betala",
  RAPPORT: "utlåtande, sakkunnigutlåtande, utredning, rapport",
  OKLASSIFICERAT: "inget av ovanstående (t.ex. brev, e-post, anteckning)",
};

/**
 * Deterministisk fallback-klassificering ur filnamnet. Snabb och alltid
 * tillgänglig — används direkt (server-first Fas 2) och som fallback när
 * LLM:en är av/inte redo/svarar med skräp.
 */
/**
 * Filnamnsregler i prioritetsordning — första träff vinner. Ordningen spelar
 * roll: INLAGA före DOM så att "yttrande till domstol" inte blir DOM ("yttr"
 * fångar förkortningar som "Yttr soc_Aktbil").
 */
const FILENAME_RULES: ReadonlyArray<readonly [RegExp, DocumentKind]> = [
  [/(stamning|stämning)/, "STAMNING"],
  [/kallelse/, "KALLELSE"],
  [/(inlaga|yttr|svaromål|svaromal|överklag|overklag|bemötande|bemotande)/, "INLAGA"],
  [/(dom|beslut|tingsr|domstol)/, "DOM"],
  [/(bevis|fotografi|bilaga|exhibit)/, "BEVIS"],
  [/(fullmakt|poa|power)/, "FULLMAKT"],
  [/(avtal|kontrakt|hyres|köpe|köpeavtal)/, "AVTAL"],
  [/(faktura|invoice|kvitto|receipt)/, "FAKTURA"],
  [/(rapport|utlatande|utlåtande|expert)/, "RAPPORT"],
];

export function guessFromFilename(name: string): DocumentKind {
  const lower = name.toLowerCase();
  return FILENAME_RULES.find(([re]) => re.test(lower))?.[1] ?? "OKLASSIFICERAT";
}
