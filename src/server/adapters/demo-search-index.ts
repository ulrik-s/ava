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
import { getDocumentContent } from "@/client/lib/demo/document-content-cache";

interface DocLike {
  id: string;
  fileName?: string;
  documentType?: string | null;
  summary?: string | null;
  matterId: string;
  organizationId: string;
}
interface MatterLike {
  id: string;
  matterNumber: string;
  title: string;
}

/**
 * Pure search-funktion: returnerar ranked hits utan I/O.
 * Exporteras separat för enkel testbarhet.
 */
export function searchDocuments(
  docs: DocLike[],
  matters: Map<string, MatterLike>,
  query: string,
  organizationId: string,
  limit: number,
): SearchResponse {
  const needle = query.toLowerCase().trim();
  if (!needle) return { hits: [], estimatedTotalHits: 0 };

  const matched = docs
    .filter((d) => d.organizationId === organizationId)
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
      const metaHit = haystack.includes(needle) ? 1 : 0;
      const contentHit = contentLc.includes(needle) ? 1 : 0;
      // Boost för treff i fileName/documentType (mer specifika)
      const titleHit = (d.fileName ?? "").toLowerCase().includes(needle) ? 2 : 0;
      const typeHit = (d.documentType ?? "").toLowerCase().includes(needle) ? 1 : 0;
      // Hitta snippet med kontextkulor runt query för UI:n
      let snippet = d.summary ?? "";
      if (contentHit && !metaHit) {
        const idx = contentLc.indexOf(needle);
        const start = Math.max(0, idx - 60);
        const end = Math.min(contentOrig.length, idx + needle.length + 60);
        snippet = (start > 0 ? "…" : "") + contentOrig.slice(start, end) + (end < contentOrig.length ? "…" : "");
      }
      return { doc: d, score: metaHit + contentHit + titleHit + typeHit, snippet };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, snippet }) => {
      const m = matters.get(doc.matterId);
      return {
        id: doc.id,
        fileName: doc.fileName ?? "",
        matterId: doc.matterId,
        matterNumber: m?.matterNumber ?? "",
        matterTitle: m?.title ?? "",
        organizationId: doc.organizationId,
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
    async search(query: string, organizationId: string, limit = 20): Promise<SearchResponse> {
      // findMany utan org-filter — vi filtrerar i searchDocuments
      // (DocumentWhereInput har ingen organizationId-direkt, det går
      // via matter-relation som vår in-memory-implementation inte
      // expanderar transparent).
      const docs = await dataStore.documents.findMany({}) as unknown as DocLike[];
      const matterRows = await dataStore.matters.findMany({
        where: { organizationId },
      }) as unknown as MatterLike[];
      const matters = new Map(matterRows.map((m) => [m.id, m]));
      return searchDocuments(docs, matters, query, organizationId, limit);
    },
    async upsert() { /* no-op — vi använder live data-store, inget index att uppdatera */ },
    async remove() { /* no-op */ },
  };
}
