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

/** Skapa en ny grupp från första observerade suggestion. */
function makeGroup(key: string, s: RawSuggestion): GroupedSuggestion {
  return {
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
  };
}

/** "First non-empty wins" — bara skriva fältet om gruppen saknar värde. */
const FIRST_NON_EMPTY_FIELDS = ["email", "phone", "orgNumber", "personalNumber"] as const;

function mergeIntoGroup(g: GroupedSuggestion, s: RawSuggestion): void {
  g.suggestionIds.push(s.id);
  if (!g.roles.includes(s.role)) g.roles.push(s.role);
  for (const f of FIRST_NON_EMPTY_FIELDS) {
    if (!g[f] && s[f]) g[f] = s[f];
  }
  if (s.notes && !g.notes.includes(s.notes)) g.notes.push(s.notes);
  if (!g.documents.some((d) => d.id === s.document.id)) {
    g.documents.push(s.document);
  }
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
    if (existing) mergeIntoGroup(existing, s);
    else groups.set(key, makeGroup(key, s));
  }
  return Array.from(groups.values());
}
