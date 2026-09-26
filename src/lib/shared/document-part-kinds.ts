/**
 * Ett dokuments kategorier sett genom dess delar (#1220). Delad mellan sök-
 * indexen (typfilter + facetter), dokumentrepona (filterlistan) och UI:t.
 *
 * Ett sammansatt dokument ("kallelse + stämning") har FLERA kategorier: ett
 * typfilter träffar om NÅGON del har typen, och facetterna räknar dokumentet
 * en gång per unik deltyp. Dokument utan delar (demo, äldre, specialvärden)
 * faller tillbaka på `documentType`.
 */

/** Minsta form av en del som behövs här. */
export interface PartLike {
  documentId: string;
  kind: string;
  fromPage: number;
  toPage: number;
  deletedAt?: unknown;
}

/** Dokumentet med ev. delar. */
export interface KindCarrier {
  documentType?: string | null | undefined;
  parts?: readonly Pick<PartLike, "kind" | "fromPage" | "toPage">[] | undefined;
}

/** Dokumentets unika kategorier: delarnas typer, annars `documentType`. */
export function kindsOf(d: KindCarrier): string[] {
  if (d.parts && d.parts.length > 0) return [...new Set(d.parts.map((p) => p.kind))];
  return d.documentType ? [d.documentType] : [];
}

/** Levande delar grupperade per dokument, sorterade på sidordning. */
export function groupPartsByDocument<P extends PartLike>(parts: readonly P[]): Map<string, P[]> {
  const out = new Map<string, P[]>();
  for (const p of parts) {
    if (p.deletedAt) continue;
    out.set(p.documentId, [...(out.get(p.documentId) ?? []), p]);
  }
  for (const list of out.values()) list.sort((a, b) => a.fromPage - b.fromPage);
  return out;
}

/** Delen som innehåller sidan `page`; null om ingen (eller sidan är okänd). */
export function partForPage<P extends Pick<PartLike, "fromPage" | "toPage">>(
  parts: readonly P[] | undefined, page: number | null | undefined,
): P | null {
  if (!page || !parts) return null;
  return parts.find((p) => p.fromPage <= page && page <= p.toPage) ?? null;
}

/** Antal dokument per kategori (ett dokument räknas en gång per unik kategori). */
export function countKinds(docs: readonly KindCarrier[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of docs) {
    for (const k of kindsOf(d)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Kategorilistan för filtret (sök-sidan), sorterad på namn. */
export function kindCountsByName(docs: readonly KindCarrier[]): Array<{ type: string; count: number }> {
  return [...countKinds(docs).entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type, "sv"));
}
