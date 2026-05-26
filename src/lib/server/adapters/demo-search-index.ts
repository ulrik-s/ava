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

import type { ISearchIndex, SearchResponse } from "../ports";
import type { IDataStore } from "../data-store/IDataStore";
import { getDocumentContent } from "@/lib/client/demo/document-content-cache";

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
}

export function searchDocuments(
  docs: DocLike[],
  matters: Map<string, MatterLike>,
  query: string,
  organizationId: string,
  limit: number,
  opts: SearchOpts = {},
): SearchResponse {
  const matcher = compileNeedle(query);
  if (!matcher.raw) return { hits: [], estimatedTotalHits: 0 };

  const orgOf = (d: DocLike): string | undefined =>
    d.organizationId ?? matters.get(d.matterId)?.organizationId;

  const typeFilter = opts.documentTypes && opts.documentTypes.length > 0
    ? new Set(opts.documentTypes)
    : null;

  const matched = docs
    .filter((d) => orgOf(d) === organizationId)
    .filter((d) => typeFilter === null || (d.documentType !== null && d.documentType !== undefined && typeFilter.has(d.documentType)))
    // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Arrow function has a complexity of 15. Maximum allowed is 8.)
    .map((d) => {
      // Bevara original-content för snippet-rendering (case-känsligt),
      // sök case-insensitively via lowercase-kopia.
      const contentOrig = getDocumentContent(d.id);
      const contentLc = contentOrig.toLowerCase();
      const haystack = [
        d.fileName ?? "",
        d.documentType ?? "",
        d.summary ?? "",
      ].join(" ").toLowerCase();
      const metaHit = matcher.test(haystack) ? 1 : 0;
      const contentHit = matcher.test(contentLc) ? 1 : 0;
      // Boost för träff i fileName/documentType (mer specifika)
      const titleHit = matcher.test(d.fileName ?? "") ? 2 : 0;
      const typeHit = matcher.test(d.documentType ?? "") ? 1 : 0;
      // Hitta snippet med kontext runt query för UI:n
      let snippet = d.summary ?? "";
      if (contentHit && !metaHit) {
        const m = matcher.findMatch(contentLc);
        if (m) {
          const start = Math.max(0, m.index - 60);
          const end = Math.min(contentOrig.length, m.index + m.length + 60);
          snippet = (start > 0 ? "…" : "") + contentOrig.slice(start, end) + (end < contentOrig.length ? "…" : "");
        }
      }
      return { doc: d, score: metaHit + contentHit + titleHit + typeHit, snippet };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    // eslint-disable-next-line complexity
    .map(({ doc, snippet }) => {
      const m = matters.get(doc.matterId);
      return {
        id: doc.id,
        fileName: doc.fileName ?? "",
        storagePath: doc.storagePath ?? null,
        matterId: doc.matterId,
        matterNumber: m?.matterNumber ?? "",
        matterTitle: m?.title ?? "",
        organizationId: doc.organizationId ?? m?.organizationId ?? "",
        _formatted: {
          content: snippet,
        },
      };
    });

  return {
    hits: matched,
    estimatedTotalHits: matched.length,
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
      return searchDocuments(docs, matters, query, organizationId, limit, opts);
    },
    async upsert() { /* no-op — vi använder live data-store, inget index att uppdatera */ },
    async remove() { /* no-op */ },
  };
}
