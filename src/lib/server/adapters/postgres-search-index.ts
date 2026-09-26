/**
 * `PostgresSearchIndex` (#1215) — server-first:s riktiga fulltextsökning.
 *
 * Läser sidtexterna i `document_pages` (skrivna av dokumentjobben via
 * `replacePages`) och söker med Postgres fulltext: `websearch_to_tsquery`
 * mot den genererade `tsv`-kolumnen ('swedish'-stemming → "stämningar"
 * hittar "stämning"), `ts_rank` för rankning och `ts_headline` för snippet.
 * Metadata (filnamn/typ/sammanfattning) matchas som i demon (substring, `*`-
 * wildcard) via den delade `search-scoring` — så rankning och facetter beter
 * sig lika i alla omfång. Med `*` i frågan matchas sidtexten med ILIKE.
 *
 * Org-scopning: dokument saknar org-kolumn → via ärendet (documents → matters).
 * Radera­de (tombstonade) dokument hittas aldrig.
 */

import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { asId, type DocumentId, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { documentPages, documents, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import type { IDocumentPageIndex, IndexableDocument, ISearchIndex, ISearchOpts, SearchHit, SearchResponse } from "../ports";
import {
  compileNeedle, computeFacetEntries, documentTypeFilter, metadataScore, type NeedleMatcher,
} from "./search-scoring";

/** Markörer runt träffar i `ts_headline` — byts mot `<mark>` EFTER HTML-escaping. */
const MARK_START = "\u0001";
const MARK_END = "\u0002";
const HEADLINE_OPTS = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=30, MinWords=12, MaxFragments=2`;

/** Tolkad sökterm: substring/wildcard-matcher + tsquery + ILIKE-mönster. */
interface Needle {
  matcher: NeedleMatcher;
  tsQuery: SQL;
  likePattern: string;
}

/** En kandidat (dokument som matchar i innehåll och/eller metadata). */
interface Candidate {
  id: DocumentId;
  fileName: string;
  storagePath: string;
  matterId: MatterId;
  documentType: string | null;
  summary: string | null;
  matterNumber: string;
  matterTitle: string;
  organizationId: OrganizationId;
  page: number | null;
  rank: number | null;
}

interface Scored extends Candidate { score: number }

/** ILIKE-mönster ur needlen: escape `\ % _`, `*` → `%`, substring på båda sidor. */
export function likePatternOf(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "%")}%`;
}

function parseNeedle(query: string): Needle | null {
  const matcher = compileNeedle(query);
  if (!matcher.raw) return null;
  return {
    matcher,
    tsQuery: sql`websearch_to_tsquery('swedish'::regconfig, ${matcher.raw.replace(/\*/g, " ")})`,
    likePattern: likePatternOf(matcher.raw),
  };
}

/** HTML-escape + markörer → `<mark>` (snippet renderas som HTML i UI:n). */
export function markHeadline(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replaceAll(MARK_START, "<mark>").replaceAll(MARK_END, "</mark>");
}

/** Poäng: metadata (som demon) + innehåll (1 + ts_rank) när en sida träffade. */
function scoreOf(c: Candidate, matcher: NeedleMatcher): number {
  const content = c.page === null ? 0 : 1 + (c.rank ?? 0);
  return metadataScore(c, matcher) + content;
}

function toHit(c: Scored, headline: string | undefined): SearchHit {
  return {
    id: c.id,
    fileName: c.fileName,
    storagePath: c.storagePath,
    matterId: c.matterId,
    matterNumber: c.matterNumber,
    matterTitle: c.matterTitle,
    organizationId: c.organizationId,
    page: c.page,
    _formatted: { content: headline ?? markHeadline(c.summary ?? "") },
  };
}

export class PostgresSearchIndex implements ISearchIndex, IDocumentPageIndex {
  constructor(private readonly db: AppDb) {}

  async search(query: string, organizationId: string, limit = 20, opts: ISearchOpts = {}): Promise<SearchResponse> {
    const needle = parseNeedle(query);
    if (!needle) return { hits: [], estimatedTotalHits: 0 };
    const scope = this.scope(asId<"OrganizationId">(organizationId), opts.matterId);
    const candidates = (await this.candidates(needle, scope))
      .map((c) => ({ ...c, score: scoreOf(c, needle.matcher) }))
      .filter((c) => c.score > 0);
    const matched = candidates.filter(documentTypeFilter(opts.documentTypes)).sort((a, b) => b.score - a.score);
    const top = matched.slice(0, limit);
    const headlines = await this.headlines(needle, top);
    return {
      hits: top.map((c) => toHit(c, headlines.get(c.id))),
      estimatedTotalHits: matched.length,
      facets: { documentTypes: computeFacetEntries(candidates) },
    };
  }

  /** Ersätt dokumentets sidor (delete + insert i en transaktion). */
  async replacePages(documentId: DocumentId, pages: readonly string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(documentPages).where(eq(documentPages.documentId, documentId));
      if (pages.length === 0) return;
      await tx.insert(documentPages).values(pages.map((text, i) => ({ documentId, pageNo: i + 1, text })));
    });
  }

  /** Porten `ISearchIndex.upsert`: hela innehållet som en enda sida. */
  async upsert(doc: IndexableDocument): Promise<void> {
    await this.replacePages(asId<"DocumentId">(doc.id), doc.content ? [doc.content] : []);
  }

  async remove(id: string): Promise<void> {
    await this.replacePages(asId<"DocumentId">(id), []);
  }

  /** Org (+ valfritt ärende), bara levande dokument. */
  private scope(organizationId: OrganizationId, matterId: MatterId | undefined): SQL | undefined {
    return and(
      eq(matters.organizationId, organizationId),
      isNull(documents.deletedAt),
      matterId ? eq(documents.matterId, matterId) : undefined,
    );
  }

  /** Sida-träff: stemmad fulltext, eller ILIKE när frågan har `*`. */
  private pageMatch(needle: Needle): SQL {
    return needle.matcher.hasWildcard
      ? ilike(documentPages.text, needle.likePattern)
      : sql`${documentPages.tsv} @@ ${needle.tsQuery}`;
  }

  /** Alla dokument i omfånget som träffar i innehåll (bästa sida) eller metadata. */
  private async candidates(needle: Needle, scope: SQL | undefined): Promise<Candidate[]> {
    const rank = sql<number>`ts_rank(${documentPages.tsv}, ${needle.tsQuery})`;
    const best = this.db
      .selectDistinctOn([documentPages.documentId], {
        documentId: documentPages.documentId,
        pageNo: documentPages.pageNo,
        rank: rank.as("rank"),
      })
      .from(documentPages)
      .where(this.pageMatch(needle))
      .orderBy(documentPages.documentId, desc(rank), asc(documentPages.pageNo))
      .as("best");
    const metaMatch = or(
      ilike(documents.fileName, needle.likePattern),
      ilike(documents.documentType, needle.likePattern),
      ilike(documents.summary, needle.likePattern),
    );
    return this.db
      .select({
        id: documents.id, fileName: documents.fileName, storagePath: documents.storagePath,
        matterId: documents.matterId, documentType: documents.documentType, summary: documents.summary,
        matterNumber: matters.matterNumber, matterTitle: matters.title, organizationId: matters.organizationId,
        page: best.pageNo, rank: best.rank,
      })
      .from(documents)
      .innerJoin(matters, eq(matters.id, documents.matterId))
      .leftJoin(best, eq(best.documentId, documents.id))
      .where(and(scope, or(isNotNull(best.documentId), metaMatch)));
  }

  /** `ts_headline` för träffsidan per dokument (bara de som visas). */
  private async headlines(needle: Needle, hits: readonly Candidate[]): Promise<Map<DocumentId, string>> {
    const pages = hits.flatMap((h) => (h.page === null ? [] : [and(eq(documentPages.documentId, h.id), eq(documentPages.pageNo, h.page))]));
    if (pages.length === 0) return new Map();
    const rows = await this.db
      .select({
        documentId: documentPages.documentId,
        headline: sql<string>`ts_headline('swedish'::regconfig, ${documentPages.text}, ${needle.tsQuery}, ${HEADLINE_OPTS})`,
      })
      .from(documentPages)
      .where(or(...pages));
    return new Map(rows.map((r) => [r.documentId, markHeadline(r.headline)]));
  }
}
