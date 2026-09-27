/**
 * Kostnadsräkningens dokument ↔ körning (#1230).
 *
 * Nya KR-dokument bär `billingRunId` (exakt länk). Äldre dokument saknar den
 * och kan bara knytas till en körning via tid. Två frågor besvaras här, rent
 * (utan I/O) så att servern och panelen resonerar likadant:
 *
 *   - `selectKrDocsForRun` — vilka dokument ska tas bort när körningen ångras?
 *     Äldre dokument bara om exakt ett är entydigt körningens; annars inget.
 *   - `pickKrDocForRun` — vilket dokument visar panelen för körningen?
 *     Länken först; för äldre dokument närmast i tid (bästa gissning).
 */

import { KOSTNADSRAKNING_DOCUMENT_TYPE } from "./schemas/document";
import type { BillingRunId, DocumentId } from "./schemas/ids";

type DateLike = Date | string;

/** Det urvalet behöver ur ett dokument. */
export interface KrDocLike {
  id: DocumentId;
  fileName: string;
  documentType?: string | null | undefined;
  billingRunId?: BillingRunId | null | undefined;
  createdAt?: DateLike | null | undefined;
}

/** Det urvalet behöver ur en körning. */
export interface KrRunLike {
  id: BillingRunId;
  createdAt: DateLike;
}

/**
 * Hur långt FÖRE körningen ett äldre dokument får vara skapat och ändå räknas
 * som dess: i domstolsmodalen genererades PDF:en först och körningen strax efter.
 */
export const LEGACY_KR_DOC_LEAD_MS = 10 * 60 * 1000;

/** Utfallet för en körning som ångras. */
export type KrDocSelection<D extends KrDocLike> =
  /** Dokument länkade till körningen (eller exakt ett entydigt äldre). */
  | { kind: "found"; docs: D[] }
  /** Det finns olänkade KR-dokument, men inget går att knyta entydigt. */
  | { kind: "ambiguous" }
  /** Inget KR-dokument hör till körningen. */
  | { kind: "none" };

const ms = (d: DateLike | null | undefined): number => (d ? new Date(d).getTime() : 0);

function isUnlinkedKrDoc(d: KrDocLike): boolean {
  return d.documentType === KOSTNADSRAKNING_DOCUMENT_TYPE && !d.billingRunId;
}

/** Tidsfönstret [från, till) där ett äldre dokument entydigt hör till `run`. */
function legacyWindow(run: KrRunLike, krRuns: readonly KrRunLike[]): { from: number; to: number } {
  const at = ms(run.createdAt);
  const others = krRuns.filter((r) => r.id !== run.id).map((r) => ms(r.createdAt));
  const previous = Math.max(-Infinity, ...others.filter((t) => t < at));
  const next = Math.min(Infinity, ...others.filter((t) => t >= at));
  return { from: Math.max(previous + 1, at - LEGACY_KR_DOC_LEAD_MS), to: next };
}

/**
 * Dokumenten som ska bort när `run` ångras. `docs` = ärendets (ej raderade)
 * dokument; `krRuns` = ärendets alla kostnadsräknings-körningar (även ångrade),
 * som avgränsar tidsfönstret för äldre olänkade dokument.
 */
export function selectKrDocsForRun<D extends KrDocLike>(
  docs: readonly D[], run: KrRunLike, krRuns: readonly KrRunLike[],
): KrDocSelection<D> {
  const linked = docs.filter((d) => d.billingRunId === run.id);
  if (linked.length > 0) return { kind: "found", docs: linked };
  const unlinked = docs.filter(isUnlinkedKrDoc);
  if (unlinked.length === 0) return { kind: "none" };
  const { from, to } = legacyWindow(run, krRuns);
  const inWindow = unlinked.filter((d) => ms(d.createdAt) >= from && ms(d.createdAt) < to);
  const only = inWindow.length === 1 ? inWindow[0] : undefined;
  return only ? { kind: "found", docs: [only] } : { kind: "ambiguous" };
}

/**
 * Dokumentet panelen länkar för körningen: det länkade; annars (äldre
 * dokument utan länk) det olänkade KR-dokumentet närmast körningen i tid.
 */
export function pickKrDocForRun<D extends KrDocLike>(docs: readonly D[], run: KrRunLike): D | null {
  const linked = docs.find((d) => d.billingRunId === run.id);
  if (linked) return linked;
  const at = ms(run.createdAt);
  const distance = (d: D): number => Math.abs(ms(d.createdAt) - at);
  const sorted = docs.filter(isUnlinkedKrDoc).sort((a, b) => distance(a) - distance(b));
  return sorted[0] ?? null;
}
