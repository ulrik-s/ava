/**
 * Jävskontrollens matchning (#1123): förnamn, efternamn och person-/orgnummer
 * — tillsammans eller var för sig.
 *
 * Förut jämfördes söktermen mot HELA namnet som en sträng (bigram-Jaccard,
 * tröskel 0.4): "Anna" mot "Anna Karlsson" fick för låg poäng och missades,
 * och "Anna 19800101-1234" förstörde både namn- och nummersökningen.
 *
 * Nu delas termen i ord. Varje namnord matchas mot namnets ord i valfri ordning
 * (prefix eller ett par stavfel, å/ä/ö-normaliserat); nummer jämförs som siffror
 * (ÅÅMMDD-XXXX ≈ ÅÅÅÅMMDD-XXXX). En jävskontroll får inte missa: träff om numret
 * stämmer ELLER om alla namnord stämmer — bäst först.
 */

import { normalize } from "./fuzzy-similarity";

export type ConflictSearchType = "name" | "personalNumber" | "both";

export interface ConflictQuery {
  /** Normaliserade namnord ("anna", "karlsson"). */
  nameTokens: string[];
  /** Siffrorna i varje person-/orgnummer i termen ("198001011234"). */
  numberTokens: string[];
}

export interface ConflictCandidate {
  name: string;
  personalNumber?: string | null;
  orgNumber?: string | null;
}

/** Minst så många siffror för att en token ska räknas som ett nummer. */
const MIN_NUMBER_DIGITS = 6;

const digitsOf = (s: string): string => s.replace(/\D/g, "");

function isNumberToken(token: string): boolean {
  return /^[\d+\-\s]+$/.test(token) && digitsOf(token).length >= MIN_NUMBER_DIGITS;
}

/**
 * Dela söktermen i namnord och nummer. I nummerläget räknas alla siffror som
 * nummer — även de fyra sista ("1234"), som man ofta söker på.
 */
export function parseConflictQuery(term: string, searchType: ConflictSearchType = "both"): ConflictQuery {
  if (searchType === "personalNumber") {
    const digits = digitsOf(term);
    return { nameTokens: [], numberTokens: digits ? [digits] : [] };
  }
  const raw = term.trim().split(/[\s,;]+/).filter(Boolean);
  return {
    numberTokens: raw.filter(isNumberToken).map(digitsOf),
    nameTokens: normalize(raw.filter((t) => !isNumberToken(t)).join(" ")).split(" ").filter(Boolean),
  };
}

/** 10 vs 12 siffror (sekel utelämnat) jämförs på de sista siffrorna; annars delsträng. */
function numberMatches(stored: string | null | undefined, token: string): boolean {
  const digits = digitsOf(stored ?? "");
  if (digits === "") return false;
  const [shorter, longer] = digits.length <= token.length ? [digits, token] : [token, digits];
  if (shorter.length === 10 && longer.length === 12) return longer.endsWith(shorter);
  return digits.includes(token);
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Tillåtna stavfel växer med ordets längd — korta ord måste stämma exakt/prefix. */
function allowedTypos(token: string): number {
  if (token.length >= 8) return 2;
  return token.length >= 4 ? 1 : 0;
}

function wordMatches(word: string, token: string): boolean {
  if (word.startsWith(token)) return true;
  const typos = allowedTypos(token);
  return typos > 0 && levenshtein(word, token) <= typos;
}

function allNameTokensMatch(name: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const words = normalize(name).split(" ").filter(Boolean);
  return tokens.every((t) => words.some((w) => wordMatches(w, t)));
}

function anyNumberMatches(c: ConflictCandidate, tokens: readonly string[]): boolean {
  return tokens.some((t) => numberMatches(c.personalNumber, t) || numberMatches(c.orgNumber, t));
}

/**
 * 0 = ingen träff. Annars: 1 = namnet stämmer, 2 = numret stämmer, 3 = båda.
 * `searchType` begränsar vilka delar som får ge träff.
 */
export function conflictScore(c: ConflictCandidate, q: ConflictQuery, searchType: ConflictSearchType): number {
  const byNumber = searchType !== "name" && anyNumberMatches(c, q.numberTokens);
  const byName = searchType !== "personalNumber" && allNameTokensMatch(c.name, q.nameTokens);
  return (byNumber ? 2 : 0) + (byName ? 1 : 0);
}
