/**
 * Matchningsmotor för betalfils-import (#181): camt-transaktioner →
 * bokningsbara betalningar mot AVA-fakturor.
 *
 * FLEXIBEL KASKAD (en faktura betalas inte alltid med OCR):
 *   1. Strukturerade referenser (Strd): OCR (#182) ELLER fakturanummer —
 *      kunden anger ibland fakturanumret som referens i stället för OCR.
 *      En TxDtls kan bära FLERA Strd med egna delbelopp (RfrdDocAmt) →
 *      varje referens blir en egen bokningsbar betalning (samlad betalning
 *      som täcker flera fakturor, t.ex. domstol → flera kostnadsräkningar).
 *   2. Fri text (Ustrd): fakturanummer/referens i löptext — normaliseras
 *      och matchas tokenvis (#175 fri-text-fallet växer härifrån).
 *   3. Belopp används ALDRIG som primär nyckel (delbetalning/prutning gör
 *      belopp opålitligt) — bara referens-träffar bokas.
 *   4. Tvetydigt (flera fakturor träffar) eller ingen träff → granskning,
 *      aldrig auto-match på osäker grund.
 *
 * Idempotens: varje bokad betalning bär en deterministisk referens
 * (txRef, eller `txRef#n` för delposter). Transaktioner vars referens redan
 * finns bland fakturornas betalningar flaggas som dubbletter och bokas inte.
 */

import type { CamtTransaction } from "./camt-parse";

export interface InvoiceCandidate {
  id: string;
  invoiceNumber: string | null;
  ocrReference: string | null;
  /** Fakturabelopp i öre (visning/rimlighetskoll — inte matchningsnyckel). */
  amount: number;
  /** Referenser på redan bokförda betalningar (Payment.reference) — dubblettskydd. */
  paymentReferences: readonly string[];
}

/** En bokningsbar betalning (en transaktion kan ge flera vid delbelopp). */
export interface BookablePayment {
  invoiceId: string;
  amountOre: number;
  /** Deterministisk referens för idempotens (txRef eller txRef#n). */
  reference: string;
  matchedBy: "ocr" | "invoiceNumber" | "freetext";
  tx: CamtTransaction;
}

export interface UnmatchedTransaction {
  tx: CamtTransaction;
  reason: "ingen-träff" | "tvetydig" | "dubblett" | "debet";
  /** Vid "tvetydig": de fakturor som träffades. */
  candidateInvoiceIds?: string[];
}

export interface MatchOutcome {
  bookable: BookablePayment[];
  unmatched: UnmatchedTransaction[];
}

/** Normalisera en referens-token: versaler, bara A-Z0-9. */
export function normalizeRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type RefIndex = Map<string, { invoiceId: string; matchedBy: "ocr" | "invoiceNumber" }>;

/** Index: normaliserad nyckel → faktura. OCR + fakturanr (med och utan F-prefix). */
function buildRefIndex(invoices: readonly InvoiceCandidate[]): RefIndex {
  const index: RefIndex = new Map();
  for (const inv of invoices) {
    if (inv.ocrReference) index.set(normalizeRef(inv.ocrReference), { invoiceId: inv.id, matchedBy: "ocr" });
    if (inv.invoiceNumber) {
      const norm = normalizeRef(inv.invoiceNumber);
      index.set(norm, { invoiceId: inv.id, matchedBy: "invoiceNumber" });
      const digits = inv.invoiceNumber.replace(/\D/g, "");
      // Siffervarianten (20260001) får inte skugga en annan fakturas nyckel.
      if (digits && !index.has(digits)) index.set(digits, { invoiceId: inv.id, matchedBy: "invoiceNumber" });
    }
  }
  return index;
}

/** Slå upp en rå referens i indexet (normaliserad + siffervariant). */
function lookup(index: RefIndex, raw: string): { invoiceId: string; matchedBy: "ocr" | "invoiceNumber" } | null {
  const norm = normalizeRef(raw);
  if (norm === "") return null;
  const hit = index.get(norm) ?? index.get(norm.replace(/\D/g, ""));
  return hit ?? null;
}

/** Kandidat-tokens ur fri text: hela raden + ord/nummer-sekvenser. */
function freeTextTokens(texts: readonly string[]): string[] {
  return texts.flatMap((t) => [t, ...(t.match(/[A-Za-z]?[\d][\d\- ]*\d|\d+/g) ?? [])]);
}

interface StructuredOutcome {
  payments?: BookablePayment[];
  ambiguousInvoiceIds?: string[];
}

/** Matcha en transaktions strukturerade referenser → bokningsbara delposter. */
function matchStructured(tx: CamtTransaction, index: RefIndex): StructuredOutcome | null {
  const hits: Array<{ sr: CamtTransaction["structuredRefs"][number]; hit: NonNullable<ReturnType<typeof lookup>> }> = [];
  for (const sr of tx.structuredRefs) {
    const hit = lookup(index, sr.ref);
    if (hit) hits.push({ sr, hit });
  }
  if (hits.length === 0) return null;
  // En ensam träff utan delbelopp tar hela transaktionsbeloppet.
  if (hits.length === 1) {
    const first = hits[0] as (typeof hits)[number];
    const payment: BookablePayment = {
      invoiceId: first.hit.invoiceId,
      amountOre: first.sr.amountOre ?? tx.amountOre,
      reference: tx.reference,
      matchedBy: first.hit.matchedBy,
      tx,
    };
    return { payments: [payment] };
  }
  // Flera träffar: kräver delbelopp per referens (RfrdDocAmt) för att kunna
  // allokera — annars granskning, vi gissar aldrig fördelningen.
  if (hits.some((h) => h.sr.amountOre === null)) {
    return { ambiguousInvoiceIds: [...new Set(hits.map((h) => h.hit.invoiceId))] };
  }
  return {
    payments: hits.map(({ sr, hit }, i) => ({
      invoiceId: hit.invoiceId,
      amountOre: sr.amountOre as number,
      reference: `${tx.reference}#${i + 1}`,
      matchedBy: hit.matchedBy,
      tx,
    })),
  };
}

/** Matcha fri text: exakt EN unik faktura-träff krävs, annars null/tvetydig. */
function matchFreeText(tx: CamtTransaction, index: RefIndex): { single?: BookablePayment; ambiguous?: string[] } {
  const hits = new Map<string, "ocr" | "invoiceNumber">();
  for (const token of freeTextTokens(tx.freeTexts)) {
    const hit = lookup(index, token);
    if (hit) hits.set(hit.invoiceId, hit.matchedBy);
  }
  if (hits.size === 0) return {};
  if (hits.size > 1) return { ambiguous: [...hits.keys()] };
  const [invoiceId] = [...hits.keys()] as [string];
  return { single: { invoiceId, amountOre: tx.amountOre, reference: tx.reference, matchedBy: "freetext", tx } };
}

type OneOutcome = { payments: BookablePayment[] } | { skip: UnmatchedTransaction };

/** Fri-text-benet av kaskaden (sist): exakt en träff bokar, annars granskning. */
function freeTextOutcome(tx: CamtTransaction, index: RefIndex): OneOutcome {
  const free = matchFreeText(tx, index);
  if (free.single) return { payments: [free.single] };
  if (free.ambiguous) return { skip: { tx, reason: "tvetydig", candidateInvoiceIds: free.ambiguous } };
  return { skip: { tx, reason: "ingen-träff" } };
}

/** Kaskaden för EN transaktion: debet/dubblett → strukturerat → fri text. */
function matchOne(tx: CamtTransaction, index: RefIndex, imported: ReadonlySet<string>): OneOutcome {
  if (tx.creditDebit !== "CRDT") return { skip: { tx, reason: "debet" } };
  if (imported.has(tx.reference) || imported.has(`${tx.reference}#1`)) {
    return { skip: { tx, reason: "dubblett" } };
  }
  const structured = matchStructured(tx, index);
  if (structured?.payments) return { payments: structured.payments };
  if (structured?.ambiguousInvoiceIds) {
    return { skip: { tx, reason: "tvetydig", candidateInvoiceIds: structured.ambiguousInvoiceIds } };
  }
  return freeTextOutcome(tx, index);
}

/**
 * Matcha camt-transaktioner mot faktura-kandidater. Bara CRDT (inbetalningar)
 * bokas; redan importerade (referens finns på en Payment) blir dubbletter.
 */
export function matchTransactions(
  transactions: readonly CamtTransaction[],
  invoices: readonly InvoiceCandidate[],
): MatchOutcome {
  const index = buildRefIndex(invoices);
  const imported = new Set(invoices.flatMap((i) => i.paymentReferences));
  const bookable: BookablePayment[] = [];
  const unmatched: UnmatchedTransaction[] = [];
  for (const tx of transactions) {
    const outcome = matchOne(tx, index, imported);
    if ("payments" in outcome) bookable.push(...outcome.payments);
    else unmatched.push(outcome.skip);
  }
  return { bookable, unmatched };
}
