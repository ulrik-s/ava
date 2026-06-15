/**
 * `demoSearchIndex` — client-side fritextsök för demo-mode.
 *
 * Scannar dokument-datan som finns i DemoDataStore (laddad från
 * git-repo:t) och matchar query mot fileName, documentType och
 * summary. Riktigt PDF/DOCX-content kommer i nästa iteration när
 * vi har Tika-emulation client-side.
 *
 * DRY: faktoriserar ut sökning som ren funktion — testas direkt
 * utan port-mocking.
 */

import { getDocumentContent } from "@/lib/client/demo/document-content-cache";
import type { IDataStore } from "../data-store/IDataStore";
import type { ISearchIndex, SearchResponse } from "../ports";

interface DocLike {
  id: string;
  fileName?: string;
  documentType?: string | null;
  summary?: string | null;
  matterId: string;
  /** Path till filinnehållet — propageras till hit:en så UI kan öppna. */
  storagePath?: string | null;
  /** Optional — i git-db saknar documents detta fält och vi resolver:ar via matter. */
  organizationId?: string;
}
interface MatterLike {
  id: string;
  matterNumber: string;
  title: string;
  /** Behövs för att org-scopa dokument utan eget organizationId-fält. */
  organizationId?: string;
}

/**
 * Kompilerad sökterm — antingen substring-matchning (snabb path) eller
 * regex (när användaren skrivit `*`-wildcards).
 *
 * Exporteras för testbarhet och så att andra konsumenter (server-side
 * search-index om vi någonsin lägger till en sådan) kan återanvända.
 */
export interface NeedleMatcher {
  /** True om mönstret kompilerats som regex (innehöll `*`). */
  hasWildcard: boolean;
  /** Original-needle i lowercase utan padding. */
  raw: string;
  /** Returnerar true om `haystack` innehåller en träff (case-insensitive). */
  test(haystack: string): boolean;
  /** Hittar första träff:ens position i en lowercase-sträng + längd; null om ingen träff. */
  findMatch(haystackLc: string): { index: number; length: number } | null;
}

export function compileNeedle(query: string): NeedleMatcher {
  const raw = query.toLowerCase().trim();
  const hasWildcard = raw.includes("*");
  if (!hasWildcard) {
    return {
      hasWildcard: false, raw,
      test: (h) => h.toLowerCase().includes(raw),
      findMatch: (hLc) => {
        const i = hLc.indexOf(raw);
        return i < 0 ? null : { index: i, length: raw.length };
      },
    };
  }
  // Bygg regex: escape allt utom * → `.*`. Anchor varken före/efter (substring).
  const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(escaped, "i");
  return {
    hasWildcard: true, raw,
    test: (h) => re.test(h),
    findMatch: (hLc) => {
      const m = re.exec(hLc);
      return m ? { index: m.index, length: m[0].length } : null;
    },
  };
}

/**
 * Pure search-funktion: returnerar ranked hits utan I/O.
 * Exporteras separat för enkel testbarhet.
 *
 * Stödjer `*` som wildcard (matchar 0+ tecken) — `stäm*ansökan` matchar
 * "stämningsansökan". Annars vanlig substring-match.
 */
export interface SearchOpts {
  /** Begränsa till dokument vars documentType matchar någon i listan.
   *  Tomt array eller undefined = alla typer. */
  documentTypes?: string[];
  /** Max antal träffar (default 20). */
  limit?: number;
}

type SearchHit = SearchResponse["hits"][number];

/** Viktad träff: `weight` om needle matchar `text`, annars 0. */
function hit(matcher: NeedleMatcher, text: string, weight: number): number {
  return matcher.test(text) ? weight : 0;
}

/** Poängsätt ett dokument. Boost för träff i fileName/documentType (mer specifika). */
function scoreDoc(
  d: DocLike,
  matcher: NeedleMatcher,
  contentLc: string,
): { score: number; metaHit: number; contentHit: number } {
  const haystack = [d.fileName ?? "", d.documentType ?? "", d.summary ?? ""].join(" ").toLowerCase();
  const metaHit = hit(matcher, haystack, 1);
  const contentHit = hit(matcher, contentLc, 1);
  const titleHit = hit(matcher, d.fileName ?? "", 2);
  const typeHit = hit(matcher, d.documentType ?? "", 1);
  return { score: metaHit + contentHit + titleHit + typeHit, metaHit, contentHit };
}

/** Snippet med kontext runt query för UI:n (faller tillbaka på summary). */
function buildSnippet(
  d: DocLike,
  matcher: NeedleMatcher,
  contentOrig: string,
  contentLc: string,
  s: { metaHit: number; contentHit: number },
): string {
  let snippet = d.summary ?? "";
  if (s.contentHit && !s.metaHit) {
    const m = matcher.findMatch(contentLc);
    if (m) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(contentOrig.length, m.index + m.length + 60);
      snippet = (start > 0 ? "…" : "") + contentOrig.slice(start, end) + (end < contentOrig.length ? "…" : "");
    }
  }
  return snippet;
}

/** Matter-härledda fält med tom-sträng-defaults. */
function matterFields(m: MatterLike | undefined): {
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
} {
  return {
    matterNumber: m?.matterNumber ?? "",
    matterTitle: m?.title ?? "",
    organizationId: m?.organizationId ?? "",
  };
}

function toSearchHit(doc: DocLike, snippet: string, matters: Map<string, MatterLike>): SearchHit {
  const mf = matterFields(matters.get(doc.matterId));
  return {
    id: doc.id,
    fileName: doc.fileName ?? "",
    storagePath: doc.storagePath ?? null,
    matterId: doc.matterId,
    matterNumber: mf.matterNumber,
    matterTitle: mf.matterTitle,
    organizationId: doc.organizationId ?? mf.organizationId,
    _formatted: {
      content: snippet,
    },
  };
}

/** Facet-räknare per documentType (för typ-filter-badges), sorterad fallande. */
function computeFacetEntries(queryMatches: DocLike[]): Array<{ type: string; count: number }> {
  const facetCounts = new Map<string, number>();
  for (const d of queryMatches) {
    if (!d.documentType) continue;
    facetCounts.set(d.documentType, (facetCounts.get(d.documentType) ?? 0) + 1);
  }
  return [...facetCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "sv"));
}

export function searchDocuments(
  docs: DocLike[],
  matters: Map<string, MatterLike>,
  query: string,
  organizationId: string,
  opts: SearchOpts = {},
): SearchResponse {
  const limit = opts.limit ?? 20;
  const matcher = compileNeedle(query);
  if (!matcher.raw) return { hits: [], estimatedTotalHits: 0 };

  const orgOf = (d: DocLike): string | undefined =>
    d.organizationId ?? matters.get(d.matterId)?.organizationId;

  const typeFilter = opts.documentTypes && opts.documentTypes.length > 0
    ? new Set(opts.documentTypes)
    : null;

  // Steg 1: hitta ALLA dokument i org som matchar query, oavsett type-filter.
  //   - Behövs för facet-counts (badges visar hur många träffar varje typ
  //     SKULLE ge — så user kan toggla utan att tappa kontext).
  //   - Tar bara ett extra pass över redan-filtrerade docs; billigt.
  const orgDocs = docs.filter((d) => orgOf(d) === organizationId);
  const queryMatches = orgDocs.filter((d) => {
    const haystack = [d.fileName ?? "", d.documentType ?? "", d.summary ?? ""].join(" ").toLowerCase();
    if (matcher.test(haystack)) return true;
    return matcher.test(getDocumentContent(d.id).toLowerCase());
  });
  const facetEntries = computeFacetEntries(queryMatches);

  const matched = orgDocs
    .filter((d) => typeFilter === null || (d.documentType !== null && d.documentType !== undefined && typeFilter.has(d.documentType)))
    .map((d) => {
      // Bevara original-content för snippet-rendering (case-känsligt),
      // sök case-insensitively via lowercase-kopia.
      const contentOrig = getDocumentContent(d.id);
      const contentLc = contentOrig.toLowerCase();
      const s = scoreDoc(d, matcher, contentLc);
      const snippet = buildSnippet(d, matcher, contentOrig, contentLc, s);
      return { doc: d, score: s.score, snippet };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, snippet }) => toSearchHit(doc, snippet, matters));

  return {
    hits: matched,
    estimatedTotalHits: matched.length,
    facets: { documentTypes: facetEntries },
  };
}

/**
 * Skapa en ISearchIndex som söker mot DemoDataStore.
 */
export function makeDemoSearchIndex(dataStore: IDataStore): ISearchIndex {
  return {
    async search(query: string, organizationId: string, limit = 20, opts = {}): Promise<SearchResponse> {
      // findMany utan org-filter — vi filtrerar i searchDocuments
      // (DocumentWhereInput har ingen organizationId-direkt, det går
      // via matter-relation som vår in-memory-implementation inte
      // expanderar transparent).
      const docs = await dataStore.documents.findMany({}) as unknown as DocLike[];
      const matterRows = await dataStore.matters.findMany({
        where: { organizationId },
      }) as unknown as MatterLike[];
      const matters = new Map(matterRows.map((m) => [m.id, m]));
      return searchDocuments(docs, matters, query, organizationId, { ...opts, limit });
    },
    async upsert() { /* no-op — vi använder live data-store, inget index att uppdatera */ },
    async remove() { /* no-op */ },
  };
}
