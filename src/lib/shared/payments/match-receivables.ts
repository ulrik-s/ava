/**
 * Fri-text-matchning av domstolsbetalningar mot FÖRVÄNTADE FORDRINGAR (#175).
 *
 * Domstolsverket betalar kostnadsräkningar utan OCR — referensen är fri text
 * (camt `RmtInf/Strd/Nb` + `InstrId`) på formatet, verifierat med byrå:
 *
 *     "1154602 3288-26 ENOKSSON"
 *      └ärendenr  └målnr   └ansvarig advokat
 *
 * En betalning splittas ofta över MÅNGA `<Strd>` (en per kostnadsräkning), var
 * och en med eget delbelopp (`RfrdDocAmt`). Vi matchar varje referens mot en
 * `ExpectedReceivable` (#173) via ärende-/målnummer och föreslår avprickning.
 *
 * SÄKERHET: vi BOKAR ALDRIG automatiskt. Matchern producerar FÖRSLAG som en
 * människa bekräftar (→ `expectedReceivable.settle`). Belopp används aldrig som
 * nyckel (prutning gör utbetalt ≠ begärt). Tvetydiga/uteblivna träffar går till
 * granskning. Idempotens: förslagets `reference` (txRef / txRef#n) jämförs mot
 * redan avprickade `paymentReference` → dubbletter filtreras.
 */

import type { CamtTransaction } from "./camt-parse";
import { normalizeRef } from "./match-payments";

export interface ReceivableCandidate {
  id: string;
  /** Ärendenummer (AVA/KATS) — t.ex. "1154602" eller "F-2026-0001". */
  matterNumber: string | null;
  /** Domstolens målnummer — t.ex. "3288-26" (Matter.courtCaseNumber, #173). */
  courtCaseNumber: string | null;
  /** Begärt belopp (öre) — visning, ej matchningsnyckel. */
  expectedAmount: number;
  /** Redan avprickade referenser (paymentReference) — dubblettskydd. */
  settledReferences: readonly string[];
}

export interface ReceivableSuggestion {
  receivableId: string;
  /** Faktiskt utbetalt belopp (öre) — delbeloppet om split, annars tx-beloppet. */
  amountOre: number;
  /** Deterministisk referens (txRef / txRef#n) för idempotent settle. */
  reference: string;
  matchedBy: "courtCaseNumber" | "matterNumber";
  /** Den råa camt-referens som träffade (för granskning/visning). */
  matchedText: string;
}

export interface ReceivableReviewItem {
  tx: CamtTransaction;
  matchedText: string;
  reason: "tvetydig" | "ingen-träff";
  candidateReceivableIds?: string[];
}

export interface ReceivableMatchOutcome {
  suggestions: ReceivableSuggestion[];
  review: ReceivableReviewItem[];
}

/** Är `needle` (normaliserad nyckel) en token i `haystack` (normaliserad ref)? */
function refContains(haystackRaw: string, needleRaw: string | null): boolean {
  if (!needleRaw) return false;
  const needle = normalizeRef(needleRaw);
  // Minst 3 tecken krävs för att undvika slumpträffar på korta nummer.
  if (needle.length < 3) return false;
  return normalizeRef(haystackRaw).includes(needle);
}

/** Hitta de fordringar vars mål-/ärendenummer förekommer i referenstexten. */
function candidatesForRef(text: string, receivables: readonly ReceivableCandidate[]): Array<{ r: ReceivableCandidate; by: "courtCaseNumber" | "matterNumber" }> {
  const hits: Array<{ r: ReceivableCandidate; by: "courtCaseNumber" | "matterNumber" }> = [];
  for (const r of receivables) {
    // Målnummer är mest specifikt → föredra det.
    if (refContains(text, r.courtCaseNumber)) hits.push({ r, by: "courtCaseNumber" });
    else if (refContains(text, r.matterNumber)) hits.push({ r, by: "matterNumber" });
  }
  return hits;
}

/** En referens (en `<Strd>` eller fri-text-rad) → förslag eller granskning. */
function matchRef(
  tx: CamtTransaction,
  text: string,
  amountOre: number,
  reference: string,
  receivables: readonly ReceivableCandidate[],
): ReceivableSuggestion | ReceivableReviewItem | null {
  const hits = candidatesForRef(text, receivables);
  if (hits.length === 0) return null; // ingen fordran nämnd i denna ref
  if (hits.length > 1) {
    return { tx, matchedText: text, reason: "tvetydig", candidateReceivableIds: hits.map((h) => h.r.id) };
  }
  const { r, by } = hits[0]!;
  if (r.settledReferences.includes(reference)) return null; // redan avprickad (dubblett)
  return { receivableId: r.id, amountOre, reference, matchedBy: by, matchedText: text };
}

/** Referens-rader för en transaktion: strukturerade (med delbelopp) + fri text. */
function refLines(tx: CamtTransaction): Array<{ text: string; amountOre: number; reference: string }> {
  const structured = tx.structuredRefs.map((sr, i) => ({
    text: sr.ref,
    amountOre: sr.amountOre ?? tx.amountOre,
    reference: tx.structuredRefs.length > 1 ? `${tx.reference}#${i + 1}` : tx.reference,
  }));
  // Fri text bär inget eget delbelopp → hela tx-beloppet (sällan split där).
  const free = tx.freeTexts.map((t) => ({ text: t, amountOre: tx.amountOre, reference: tx.reference }));
  return [...structured, ...free];
}

function isSuggestion(x: ReceivableSuggestion | ReceivableReviewItem): x is ReceivableSuggestion {
  return "receivableId" in x;
}

/**
 * Matcha camt-transaktioner mot förväntade fordringar (#173). Bara CRDT.
 * Returnerar FÖRSLAG (människa bekräftar) + en granskningslista för tvetydiga.
 */
export function matchReceivables(
  transactions: readonly CamtTransaction[],
  receivables: readonly ReceivableCandidate[],
): ReceivableMatchOutcome {
  const suggestions: ReceivableSuggestion[] = [];
  const review: ReceivableReviewItem[] = [];
  const claimed = new Set<string>();

  for (const tx of transactions) {
    if (tx.creditDebit !== "CRDT") continue;
    for (const line of refLines(tx)) {
      const out = matchRef(tx, line.text, line.amountOre, line.reference, receivables);
      if (!out) continue;
      if (isSuggestion(out)) {
        // En fordran får bara föreslås en gång per fil.
        if (claimed.has(out.receivableId)) continue;
        claimed.add(out.receivableId);
        suggestions.push(out);
      } else {
        review.push(out);
      }
    }
  }
  return { suggestions, review };
}
