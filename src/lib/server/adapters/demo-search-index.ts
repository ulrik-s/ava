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
import {
  compileNeedle, computeFacetEntries, documentTypeFilter, metaHaystack, metadataScore, type NeedleMatcher,
} from "./search-scoring";

interface DocLike {
  id: string;
  fileName?: string;
  documentType?: string | null | undefined;
  summary?: string | null | undefined;
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
  /** Bara dokument i detta ärende (#1215). */
  matterId?: string;
  /** Max antal träffar (default 20). */
  limit?: number;
}

type SearchHit = SearchResponse["hits"][number];

/** Poängsätt ett dokument: metadata-poäng + 1 för träff i innehållet. */
function scoreDoc(
  d: DocLike,
  matcher: NeedleMatcher,
  contentLc: string,
): { score: number; metaHit: number; contentHit: number } {
  const metaHit = matcher.test(metaHaystack(d)) ? 1 : 0;
  const contentHit = matcher.test(contentLc) ? 1 : 0;
  return { score: metadataScore(d, matcher) + contentHit, metaHit, contentHit };
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
    // Demons innehållscache är sidlös (ihopslagen text) → sidan är okänd.
    page: null,
    _formatted: {
      content: snippet,
    },
  };
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

  const typeFilter = documentTypeFilter(opts.documentTypes);
  const inScope = (d: DocLike): boolean =>
    orgOf(d) === organizationId && (!opts.matterId || d.matterId === opts.matterId);

  // Steg 1: hitta ALLA dokument i org som matchar query, oavsett type-filter.
  //   - Behövs för facet-counts (badges visar hur många träffar varje typ
  //     SKULLE ge — så user kan toggla utan att tappa kontext).
  //   - Tar bara ett extra pass över redan-filtrerade docs; billigt.
  const orgDocs = docs.filter(inScope);
  const queryMatches = orgDocs.filter((d) =>
    matcher.test(metaHaystack(d)) || matcher.test(getDocumentContent(d.id).toLowerCase()));
  const facetEntries = computeFacetEntries(queryMatches);

  const matched = orgDocs
    .filter(typeFilter)
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
      const docs: DocLike[] = await dataStore.documents.findMany({});
      const matterRows: MatterLike[] = await dataStore.matters.findMany({
        where: { organizationId },
      });
      const matters = new Map(matterRows.map((m) => [m.id, m]));
      return searchDocuments(docs, matters, query, organizationId, { ...opts, limit });
    },
    async upsert() { /* no-op — vi använder live data-store, inget index att uppdatera */ },
    async remove() { /* no-op */ },
  };
}
