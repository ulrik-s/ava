/**
 * Grupperar AI-förslag så samma person/entitet bara visas en gång i
 * ärendevyn — även om hen förekommer i flera dokument eller i flera roller.
 *
 * Grupperingsnyckel (i fallande prioritet):
 *   1. personalNumber    – stabil identitet för personer
 *   2. orgNumber         – stabil identitet för företag/myndigheter
 *   3. normalized name + contactType  – fallback när ID saknas
 *
 * Inom en grupp sammanslås:
 *   - roles: alla distinkta roller som förekommit
 *   - email/phone: första icke-tomma värde (dokumenten kan vara motsägande)
 *   - notes: alla distinkta anteckningar listas
 *   - documents: varje källdokument listas en gång
 */

export interface RawSuggestion {
  id: string;
  name: string;
  role: string;
  contactType: string;
  email: string | null;
  phone: string | null;
  orgNumber: string | null;
  personalNumber: string | null;
  notes: string | null;
  document: { id: string; fileName: string; title: string | null };
}

export interface GroupedSuggestion {
  /** Stabil grupperingsnyckel. Används av UI:t som React key. */
  key: string;
  /** Alla underliggande suggestion-id (används vid accept/reject-all). */
  suggestionIds: string[];
  /** Kanoniskt namn (första icke-tomma). */
  name: string;
  /** En entitetstyp — första icke-tomma (bör vara konsekvent inom en grupp). */
  contactType: string;
  /** Distinkta roller, ordnade efter första förekomst. */
  roles: string[];
  email: string | null;
  phone: string | null;
  orgNumber: string | null;
  personalNumber: string | null;
  /** Distinkta anteckningar från alla dokument. */
  notes: string[];
  /** Källdokument, en per dokument. */
  documents: Array<{ id: string; fileName: string; title: string | null }>;
}

/** Normalizes name for fallback grouping — lowercase, collapsed whitespace. */
function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns the grouping key for a suggestion. See module-level comment. */
export function groupingKey(s: Pick<RawSuggestion, "personalNumber" | "orgNumber" | "name" | "contactType">): string {
  if (s.personalNumber?.trim()) return `pn:${s.personalNumber.trim()}`;
  if (s.orgNumber?.trim()) return `on:${s.orgNumber.trim()}`;
  return `name:${normalizeName(s.name)}|${s.contactType}`;
}

/**
 * Groups an array of suggestions into one entry per unique entity. Roles,
 * notes and source documents are aggregated; contact attributes take the
 * first non-empty value seen.
 */
export function groupSuggestions(suggestions: RawSuggestion[]): GroupedSuggestion[] {
  const groups = new Map<string, GroupedSuggestion>();

  for (const s of suggestions) {
    const key = groupingKey(s);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        suggestionIds: [s.id],
        name: s.name,
        contactType: s.contactType,
        roles: [s.role],
        email: s.email || null,
        phone: s.phone || null,
        orgNumber: s.orgNumber || null,
        personalNumber: s.personalNumber || null,
        notes: s.notes ? [s.notes] : [],
        documents: [s.document],
      });
      continue;
    }

    existing.suggestionIds.push(s.id);
    if (!existing.roles.includes(s.role)) existing.roles.push(s.role);
    // "First non-empty wins" — prefer non-null attribute from later rows only
    // if current is null.
    if (!existing.email && s.email) existing.email = s.email;
    if (!existing.phone && s.phone) existing.phone = s.phone;
    if (!existing.orgNumber && s.orgNumber) existing.orgNumber = s.orgNumber;
    if (!existing.personalNumber && s.personalNumber) existing.personalNumber = s.personalNumber;
    if (s.notes && !existing.notes.includes(s.notes)) existing.notes.push(s.notes);
    if (!existing.documents.some((d) => d.id === s.document.id)) {
      existing.documents.push(s.document);
    }
  }

  return Array.from(groups.values());
}
