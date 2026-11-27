/**
 * Igenkänning av ett SLUTLIGT AVGÖRANDE i ett dokuments text (#2099).
 *
 * Att åtgärda frågar om ärendet ska avslutas när ett dokument ser ut att vara
 * ett slutligt avgörande. Här bestäms bara OM texten är ett sådant, och i så
 * fall vilket: ett slutligt beslut om avskrivning, en dom från Högsta
 * domstolen (HD) eller Högsta förvaltningsdomstolen (HFD), eller ett beslut
 * från HD eller HFD att inte meddela prövningstillstånd.
 *
 * Som `document-extraction.ts` är den deterministisk och inte en LLM (ADR
 * 0027): samma text ger samma svar i alla tier, också i demon utan server.
 *
 * Den är medvetet FÖRSIKTIG. Hellre inget förslag än ett gissat: domstolens
 * namn räcker aldrig, eftersom hovrättens och kammarrättens avgöranden nämner
 * HD, HFD och prövningstillstånd i överklagandehänvisningen ("Om Högsta
 * domstolen inte meddelar prövningstillstånd står hovrättens avgörande fast").
 * Varje regel kräver därför domstolens EGEN formulering.
 */

import type { FinalRuling } from "./schemas/document";

/**
 * Slå ihop avstavning vid radslut ("hand-\nläggning" → "handläggning", också
 * i en rubrik med versaler: "FÖRVALTNINGS-\nDOMSTOLENS") och
 * gör blanktecken inom en rad till ett mellanslag. Radbrytningarna står kvar:
 * avskrivningsregeln behöver veta var en rad börjar. Övriga regler matchar
 * med `\s+`, så en radbrytning inne i en mening räknas som mellanslag.
 */
export function normalizeRulingText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(\p{Ll})-[ \t]*\n[ \t]*(\p{Ll})/gu, "$1$2")
    .replace(/(\p{Lu})-[ \t]*\n[ \t]*(\p{Lu})/gu, "$1$2")
    .replace(/[ \t\f\v\u00a0]+/g, " ");
}

/** Målnumret som får stå mellan rubriken och "meddelad i Stockholm". */
const CASE_NUMBER = String.raw`(?:mål\s*nr\.?:?(?:\s*[a-zåäö]{0,2}\s*\d+[-–]\d+)?\s+)?`;

const DOM_HD = new RegExp(String.raw`högsta\s+domstolens\s+dom\s+${CASE_NUMBER}meddelad\s+i\s+stockholm`, "iu");
const DOM_HFD = new RegExp(String.raw`högsta\s+förvaltningsdomstolens\s+dom\s+${CASE_NUMBER}meddelad\s+i\s+stockholm`, "iu");

/** Domstolens egen rubrik: "Högsta domstolens dom … meddelad i Stockholm". */
function detectSupremeJudgment(text: string): FinalRuling | null {
  if (DOM_HD.test(text)) return "DOM_HD";
  if (DOM_HFD.test(text)) return "DOM_HFD";
  return null;
}

const PT_HD = /högsta\s+domstolen\s+meddelar\s+inte\s+prövningstillstånd/iu;
const PT_HFD = /högsta\s+förvaltningsdomstolen\s+meddelar\s+inte\s+prövningstillstånd/iu;
const STANDS = /står\s+därmed\s+fast/iu;
/** Ett (delvis) beviljat prövningstillstånd: då är avgörandet inte slutligt. */
const GRANTED = /meddelar\s+prövningstillstånd/iu;

/** HD:s eller HFD:s beslut att inte meddela prövningstillstånd. */
function detectLeaveRefused(text: string): FinalRuling | null {
  if (!STANDS.test(text) || GRANTED.test(text)) return null;
  if (PT_HD.test(text)) return "PT_HD";
  if (PT_HFD.test(text)) return "PT_HFD";
  return null;
}

const DISMISSAL = /(?<!\p{L})(?:(?:målet|ärendet)\s+avskrivs|\p{L}+\s+avskriver\s+(?:målet|ärendet))\s+från\s+vidare\s+handläggning/giu;
/** Före meningen: textens början, eller `.`, `!`, `?`, `:` (också "1."). */
const AFTER_PUNCTUATION = /(?:^|[.!?:])\s*$/u;
const AT_LINE_START = /\n[ \t]*$/u;
const CAPITALIZED = /^\p{Lu}/u;
/** Efter "handläggning": en punkt, textens slut eller en ny rad med versal (också "2. Vardera"). */
const SENTENCE_END = /^(?:\.|\s*$|[ \t]*\n\s*(?:\d+\.\s*)?\p{Lu})/u;

/** Börjar meningen här? En ny rad räknas bara om den börjar med versal. */
function startsSentence(before: string, match: string): boolean {
  return AFTER_PUNCTUATION.test(before) || (AT_LINE_START.test(before) && CAPITALIZED.test(match));
}

/** Ett slutligt beslut om avskrivning, som en egen mening. */
function detectDismissal(text: string): FinalRuling | null {
  for (const m of text.matchAll(DISMISSAL)) {
    const end = m.index + m[0].length;
    if (startsSentence(text.slice(0, m.index), m[0]) && SENTENCE_END.test(text.slice(end))) return "AVSKRIVNING";
  }
  return null;
}

/** Reglerna i den ordning de prövas; den första träffen gäller. */
const RULES: readonly ((text: string) => FinalRuling | null)[] = [
  detectSupremeJudgment, detectLeaveRefused, detectDismissal,
];

/**
 * Vilket slutligt avgörande texten är, eller `null` om den inte tydligt är
 * ett (också för lägre instansers domar och beslut).
 */
export function detectFinalRuling(text: string): FinalRuling | null {
  const normalized = normalizeRulingText(text);
  for (const rule of RULES) {
    const hit = rule(normalized);
    if (hit !== null) return hit;
  }
  return null;
}
