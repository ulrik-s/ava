/**
 * Byråns sökregel för kontakter (#1866): en lista kontakter rangordnas mot en
 * sökterm, likadant i klienten och på servern.
 *
 * Regeln är unionen av två regler, så att ingen sökyta tappar träffar:
 *   - jävsmatchningen (`conflict-match.ts`): namnord i valfri ordning, prefix,
 *     stavfel och nummer jämförda som siffror;
 *   - delsträngsregeln: termen finns i namnet, person-/orgnumret eller e-posten
 *     (också de fyra sista siffrorna och en delsträng mitt i ett ord).
 *
 * Jävsträffar rangordnas före delsträngsträffar.
 */

import { conflictScore, parseConflictQuery, type ConflictCandidate, type ConflictQuery } from "./conflict-match";

/** En kontakt som kan sökas: jävskontrollens fält plus e-posten. */
export interface ContactSearchCandidate extends ConflictCandidate {
  email?: string | null | undefined;
}

/** Svensk skiftlägesvikning (Å/Ä/Ö som egna bokstäver). */
const fold = (s: string): string => s.toLocaleLowerCase("sv");

/** Delsträngsregeln: den vikta nålen finns i namnet, numren eller e-posten. */
function substringMatches(c: ContactSearchCandidate, needle: string): boolean {
  return [c.name, c.personalNumber, c.orgNumber, c.email]
    .some((field) => typeof field === "string" && fold(field).includes(needle));
}

/**
 * Kontaktens rang mot en tolkad fråga och en vikt nål: 4/3/2 när jävspoängen
 * är 3/2/1, 1 när bara delsträngsregeln träffar och 0 när inget träffar.
 */
export function contactSearchRank(c: ContactSearchCandidate, query: ConflictQuery, needle: string): number {
  const score = conflictScore(c, query, "both");
  if (score > 0) return score + 1;
  return substringMatches(c, needle) ? 1 : 0;
}

/**
 * Kontakterna som träffar termen, bäst först och inom samma rang i svensk
 * namnordning. En term som är tom efter trim ger en tom lista.
 */
export function rankContacts<C extends ContactSearchCandidate>(contacts: readonly C[], term: string): C[] {
  const needle = fold(term.trim());
  if (needle === "") return [];
  const query = parseConflictQuery(term);
  return contacts
    .map((c) => ({ c, rank: contactSearchRank(c, query, needle) }))
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.c.name.localeCompare(b.c.name, "sv"))
    .map((r) => r.c);
}
