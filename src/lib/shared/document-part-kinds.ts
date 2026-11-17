/**
 * Dokumentdelar (#1220) och räkning per typ. Delad mellan sökindexen (typfilter
 * + facetter), dokumentrepona (filterlistan) och UI:t.
 *
 * Ett dokuments typer är EN lista (ADR 0038, `documentKinds`): ett typfilter
 * träffar om dokumentet har NÅGON av typerna, och facetterna räknar dokumentet
 * en gång per typ. Delarna säger var i PDF:en varje typ finns.
 */

import { documentKinds, type KindsCarrier } from "./document-kinds";

/** Minsta form av en del som behövs här. */
export interface PartLike {
  documentId: string;
  kind: string;
  fromPage: number;
  toPage: number;
  deletedAt?: unknown;
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
export function countKinds(docs: readonly KindsCarrier[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of docs) {
    for (const k of documentKinds(d)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Kategorilistan för filtret (sök-sidan), sorterad på namn. */
export function kindCountsByName(docs: readonly KindsCarrier[]): Array<{ type: string; count: number }> {
  return [...countKinds(docs).entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type, "sv"));
}
