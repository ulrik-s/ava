/**
 * Delad sök-logik (ren, ingen I/O) för dokumentsökningens två index (#1215):
 * demons in-process-skanning (`demo-search-index`) och serverns Postgres-index
 * (`postgres-search-index`). Samma sökterms-tolkning (`*`-wildcard), samma
 * metadata-poäng (filnamn/typ/sammanfattning) och samma facett-räkning — så
 * rankning och typ-badges beter sig lika oavsett omfång.
 *
 * Typfilter och facetter går på dokumentets DELAR (#1220): ett sammansatt
 * dokument träffar filtret om någon del har typen och räknas i varje dels typ.
 */

import { kindLabel } from "@/lib/shared/document-kind";
import { documentKinds, type KindsCarrier } from "@/lib/shared/document-kinds";
import { countKinds } from "@/lib/shared/document-part-kinds";

/**
 * Kompilerad sökterm — antingen substring-matchning (snabb path) eller
 * regex (när användaren skrivit `*`-wildcards).
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

/**
 * Stödjer `*` som wildcard (matchar 0+ tecken) — `stäm*ansökan` matchar
 * "stämningsansökan". Annars vanlig substring-match.
 */
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

/** Metadata-fälten som poängsätts (utöver innehållet). Typerna via läsregeln (ADR 0038). */
export interface ScorableMeta extends KindsCarrier {
  fileName?: string | null | undefined;
  summary?: string | null | undefined;
}

/** Typernas visningsnamn — sökningen matchar "Stämning", inte koden STAMNING. */
function kindText(d: KindsCarrier): string {
  return documentKinds(d).map(kindLabel).join(" ");
}

/** Viktad träff: `weight` om needle matchar `text`, annars 0. */
function hit(matcher: NeedleMatcher, text: string, weight: number): number {
  return matcher.test(text) ? weight : 0;
}

/** Sökbar metadata-text (filnamn + typ + sammanfattning). */
export function metaHaystack(d: ScorableMeta): string {
  return [d.fileName ?? "", kindText(d), d.summary ?? ""].join(" ");
}

/**
 * Metadata-poäng: 1 för träff någonstans i metadatan, +2 för träff i filnamnet
 * och +1 i typen (de mer specifika fälten). 0 = ingen metadata-träff.
 */
export function metadataScore(d: ScorableMeta, matcher: NeedleMatcher): number {
  return hit(matcher, metaHaystack(d), 1) + hit(matcher, d.fileName ?? "", 2) + hit(matcher, kindText(d), 1);
}

/** Facet-räknare per typ (ADR 0038), sorterad fallande. */
export function computeFacetEntries(
  queryMatches: readonly KindsCarrier[],
): Array<{ type: string; count: number }> {
  return [...countKinds(queryMatches).entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "sv"));
}

/**
 * Typ-filtret som predikat. Tom lista/undefined = alla typer; annars bara
 * dokument som har NÅGON av typerna (ADR 0038).
 */
export function documentTypeFilter(
  documentTypes: readonly string[] | undefined,
): (d: KindsCarrier) => boolean {
  if (!documentTypes || documentTypes.length === 0) return () => true;
  const allowed = new Set(documentTypes);
  return (d) => documentKinds(d).some((k) => allowed.has(k));
}
