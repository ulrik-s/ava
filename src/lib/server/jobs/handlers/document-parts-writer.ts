/**
 * Skriv dokumentdelar (#1220) efter klassificeringsjobbets segmentering.
 *
 * Regler:
 *   - AUTO-delar ERSÄTTS (gamla mjukraderas → tombstones delta-synkas).
 *   - MANUAL-delar (användaren rättade typen) bevaras om dokumentets sidantal
 *     är oförändrat — de vinner över sina sidor, nya AUTO-delar fyller resten
 *     (`overlayManualParts`). Har sidantalet ändrats (nytt innehåll) stämmer
 *     sidintervallen inte längre → allt räknas om och de manuella delarna
 *     släpps.
 *   - Oförändrad segmentering → inga skrivningar (ingen change_log-churn).
 *   - Dokument vars typer en person eller systemet satt (ADR 0038,
 *     `kindsManual`) segmenteras inte om — jobbet anropar då inte skrivaren.
 */

import { overlayManualParts, type SegmentPart, type SourcedPart } from "@/lib/shared/document-segmentation";
import type { Document, DocumentPart } from "@/lib/shared/schemas/document";
import type { DocumentPartRepository } from "../../repositories/document-part-repository";

/** Repo-ytan skrivaren behöver. */
export type PartsRepo = Pick<DocumentPartRepository, "listForDocument" | "create" | "update" | "softDelete">;

/** Dokumentfälten reglerna läser. */
export type PartsDoc = Pick<Document, "id" | "matterId">;

/** Sista sidan som delarna täcker (= sidantalet när delarna skrevs). */
function lastPage(parts: readonly DocumentPart[]): number {
  return parts.reduce((max, p) => Math.max(max, p.toPage), 0);
}

const sameRange = (a: SegmentPart, b: SegmentPart): boolean =>
  a.kind === b.kind && a.fromPage === b.fromPage && a.toPage === b.toPage;

/** Samma delar i samma ordning (typ, sidor, ursprung). */
function unchanged(existing: readonly DocumentPart[], target: readonly SourcedPart[]): boolean {
  return existing.length === target.length
    && existing.every((e, i) => { const t = target[i]; return !!t && sameRange(e, t) && e.source === t.source && e.ordinal === i; });
}

/** Manuella delar som får vara kvar givet nytt sidantal. */
function keptManual(existing: readonly DocumentPart[], pageCount: number): DocumentPart[] {
  const manual = existing.filter((p) => p.source === "MANUAL");
  return manual.length > 0 && lastPage(existing) === pageCount ? manual : [];
}

/** Skapa AUTO-delarna + synka manuella delars ordinal. */
async function writeTarget(repo: PartsRepo, doc: PartsDoc, target: readonly SourcedPart[], manual: readonly DocumentPart[]): Promise<void> {
  for (const [ordinal, t] of target.entries()) {
    const kept = manual.find((m) => t.source === "MANUAL" && sameRange(m, t));
    if (kept) {
      if (kept.ordinal !== ordinal) await repo.update(kept.id, { ordinal });
      continue;
    }
    await repo.create({
      documentId: doc.id, matterId: doc.matterId, ordinal,
      kind: t.kind, fromPage: t.fromPage, toPage: t.toPage, source: t.source,
    });
  }
}

/**
 * Ersätt dokumentets delar med `computed` (ny segmentering) för `pageCount`
 * sidor. Manuellt rättade delar bevaras (se ovan). Returnerar delarna.
 */
export async function replaceDocumentParts(
  repo: PartsRepo, doc: PartsDoc, computed: readonly SegmentPart[], pageCount: number,
): Promise<SourcedPart[]> {
  const existing = await repo.listForDocument(doc.id);
  const manual = keptManual(existing, pageCount);
  const target = overlayManualParts(computed, manual);
  if (unchanged(existing, target)) return target;
  for (const e of existing) {
    if (!manual.includes(e)) await repo.softDelete(e.id);
  }
  await writeTarget(repo, doc, target, manual);
  return target;
}
