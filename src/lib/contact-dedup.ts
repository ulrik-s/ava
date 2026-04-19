/**
 * Dedup-logik för kontakter vid accept av AI-genererade förslag.
 *
 * När en användare godkänner en "pending suggestion" ska vi *inte* skapa en
 * ny Contact-rad om personen/företaget redan finns. Matchningen körs i
 * följande prioritetsordning:
 *
 *   1. personalNumber inom organisationen (unikt per person)
 *   2. orgNumber inom organisationen      (unikt per företag/myndighet)
 *   3. Namn (case-insensitivt, trimmat) + samma contactType, men BARA bland
 *      kontakter som redan är länkade till det aktuella ärendet
 *
 * Regel #3 är medvetet snäv: namn-sammanfall kan uppstå globalt (två olika
 * Anna Svensson i olika ärenden ≠ samma person), men inom ett och samma
 * ärende är det en dubblett som ska mergas.
 *
 * Modulen är helt ren — den vet inget om Prisma. Routern laddar kandidat-
 * listorna (kan vara så små eller stora den vill) och överlåter beslutet hit.
 */

import type { ContactType } from "./labels";

// ─── Publika typer ──────────────────────────────────────────────

/**
 * Minsta gemensamma nämnare för en befintlig kontakt som kan matcha.
 * Håller typen så smal som möjligt så att callers kan bygga den från
 * vilken Prisma-select som helst.
 */
export interface ContactCandidate {
  readonly id: string;
  readonly name: string;
  readonly contactType: string;
  readonly personalNumber: string | null;
  readonly orgNumber: string | null;
  readonly organizationId: string;
}

/** De fält från ett accept-förslag som behövs för att hitta match. */
export interface SuggestionKey {
  readonly name: string;
  readonly contactType: ContactType | string; // tillåt rå sträng från DB
  readonly personalNumber: string | null;
  readonly orgNumber: string | null;
}

/** Resultat av matchning — tagged union så caller ser *varför* vi matchade. */
export type DedupResult =
  | { readonly kind: "match"; readonly reason: DedupReason; readonly contact: ContactCandidate }
  | { readonly kind: "no-match" };

export type DedupReason = "personalNumber" | "orgNumber" | "matter-name";

// ─── Logik ──────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Välj den bästa matchningen för ett accepterat förslag.
 *
 * @param suggestion      Förslagets identifierande fält.
 * @param orgContacts     Kontakter i samma organisation (för personalNumber/orgNumber).
 * @param matterContacts  Kontakter som är *länkade till samma ärende* (för namn-fallback).
 *
 * `matterContacts` ska vara en *delmängd* av `orgContacts` men det är billigt
 * nog att hålla isär listorna eftersom prisma-queryn redan filtrerar dem.
 */
export function findExistingContactForSuggestion(
  suggestion: SuggestionKey,
  orgContacts: readonly ContactCandidate[],
  matterContacts: readonly ContactCandidate[],
): DedupResult {
  // 1. personalNumber — starkast signal
  if (suggestion.personalNumber) {
    const hit = orgContacts.find((c) => c.personalNumber === suggestion.personalNumber);
    if (hit) return { kind: "match", reason: "personalNumber", contact: hit };
  }

  // 2. orgNumber
  if (suggestion.orgNumber) {
    const hit = orgContacts.find((c) => c.orgNumber === suggestion.orgNumber);
    if (hit) return { kind: "match", reason: "orgNumber", contact: hit };
  }

  // 3. Namn + contactType inom ärendet
  const needle = norm(suggestion.name);
  if (needle) {
    const hit = matterContacts.find(
      (c) => c.contactType === suggestion.contactType && norm(c.name) === needle,
    );
    if (hit) return { kind: "match", reason: "matter-name", contact: hit };
  }

  return { kind: "no-match" };
}
