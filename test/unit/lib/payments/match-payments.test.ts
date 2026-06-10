/**
 * Test för matchningsmotorn (#181) — den flexibla kaskaden:
 * OCR → fakturanummer (strukturerat ELLER fri text) → granskning.
 * Inkl. delbelopps-allokering (flera Strd), dubblettskydd och debet-skip.
 */

import { describe, it, expect } from "vitest-compat";

import { buildOcrReference } from "@/lib/shared/ocr-reference";
import type { CamtTransaction } from "@/lib/shared/payments/camt-parse";
import {
  matchTransactions,
  normalizeRef,
  type InvoiceCandidate,
} from "@/lib/shared/payments/match-payments";

const OCR_1 = buildOcrReference("20260001");
const OCR_2 = buildOcrReference("20260002");

const INVOICES: InvoiceCandidate[] = [
  { id: "inv-1", invoiceNumber: "F-2026-0001", ocrReference: OCR_1, amount: 100_000, paymentReferences: [] },
  { id: "inv-2", invoiceNumber: "F-2026-0002", ocrReference: OCR_2, amount: 50_000, paymentReferences: [] },
  // Kostnadsräkning till domstol: varken OCR eller fakturanummer (#173).
  { id: "inv-court", invoiceNumber: null, ocrReference: null, amount: 75_000, paymentReferences: [] },
];

function tx(over: Partial<CamtTransaction>): CamtTransaction {
  return {
    reference: "TX-1",
    amountOre: 100_000,
    currency: "SEK",
    valueDate: "2026-06-01",
    debtorName: "Klient AB",
    creditDebit: "CRDT",
    structuredRefs: [],
    freeTexts: [],
    ...over,
  };
}

describe("normalizeRef", () => {
  it("versaler + bara alfanumeriskt", () => {
    expect(normalizeRef(" f-2026-0001 ")).toBe("F20260001");
    expect(normalizeRef("2026 0001")).toBe("20260001");
  });
});

describe("matchTransactions — kaskaden", () => {
  it("1. OCR i Strd → match", () => {
    const out = matchTransactions([tx({ structuredRefs: [{ ref: OCR_1, amountOre: null }] })], INVOICES);
    expect(out.bookable).toEqual([
      expect.objectContaining({ invoiceId: "inv-1", amountOre: 100_000, matchedBy: "ocr", reference: "TX-1" }),
    ]);
  });

  it("2. fakturanummer i Strd (kunden anger fakturanr i stället för OCR)", () => {
    const out = matchTransactions([tx({ structuredRefs: [{ ref: "F-2026-0002", amountOre: null }] })], INVOICES);
    expect(out.bookable[0]).toMatchObject({ invoiceId: "inv-2", matchedBy: "invoiceNumber" });
  });

  it("3. fakturanummer i FRI TEXT, olika skrivsätt", () => {
    for (const skrivet of ["F-2026-0001", "F20260001", "Betalning F-2026-0001 tack", "fakt 20260001"]) {
      const out = matchTransactions([tx({ freeTexts: [skrivet] })], INVOICES);
      expect(out.bookable[0]?.invoiceId, `"${skrivet}"`).toBe("inv-1");
      expect(out.bookable[0]?.matchedBy).toBe("freetext");
    }
  });

  it("4. samlad betalning: två Strd med delbelopp → två bokningsbara delposter", () => {
    const out = matchTransactions(
      [tx({
        amountOre: 150_000,
        structuredRefs: [
          { ref: OCR_1, amountOre: 100_000 },
          { ref: "F-2026-0002", amountOre: 50_000 },
        ],
      })],
      INVOICES,
    );
    expect(out.bookable).toHaveLength(2);
    expect(out.bookable[0]).toMatchObject({ invoiceId: "inv-1", amountOre: 100_000, reference: "TX-1#1" });
    expect(out.bookable[1]).toMatchObject({ invoiceId: "inv-2", amountOre: 50_000, reference: "TX-1#2" });
  });

  it("5. flera Strd UTAN delbelopp → granskning (gissar aldrig fördelningen)", () => {
    const out = matchTransactions(
      [tx({ structuredRefs: [{ ref: OCR_1, amountOre: null }, { ref: OCR_2, amountOre: null }] })],
      INVOICES,
    );
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]).toMatchObject({ reason: "tvetydig", candidateInvoiceIds: ["inv-1", "inv-2"] });
  });

  it("6. tvetydig fri text (två fakturanummer i samma Ustrd) → granskning", () => {
    const out = matchTransactions([tx({ freeTexts: ["F-2026-0001 och F-2026-0002"] })], INVOICES);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("tvetydig");
  });

  it("7. ingen träff → granskning (belopp är ALDRIG matchningsnyckel)", () => {
    // Beloppet råkar exakt matcha inv-court — men utan referens bokas inget.
    const out = matchTransactions([tx({ amountOre: 75_000, freeTexts: ["T 1234-26"] })], INVOICES);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("ingen-träff");
  });

  it("8. dubblett: referensen redan bokförd → bokas inte om", () => {
    const invoices: InvoiceCandidate[] = [
      { ...(INVOICES[0] as InvoiceCandidate), paymentReferences: ["TX-1"] },
    ];
    const out = matchTransactions([tx({ structuredRefs: [{ ref: OCR_1, amountOre: null }] })], invoices);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("dubblett");
  });

  it("9. delpost-dubblett (#1-referens) fångas också", () => {
    const invoices: InvoiceCandidate[] = [
      { ...(INVOICES[0] as InvoiceCandidate), paymentReferences: ["TX-1#1"] },
      INVOICES[1] as InvoiceCandidate,
    ];
    const out = matchTransactions(
      [tx({ structuredRefs: [{ ref: OCR_1, amountOre: 50_000 }, { ref: OCR_2, amountOre: 50_000 }] })],
      invoices,
    );
    expect(out.unmatched[0]?.reason).toBe("dubblett");
  });

  it("10. DBIT hoppas över (ej inbetalning)", () => {
    const out = matchTransactions([tx({ creditDebit: "DBIT", structuredRefs: [{ ref: OCR_1, amountOre: null }] })], INVOICES);
    expect(out.bookable).toHaveLength(0);
    expect(out.unmatched[0]?.reason).toBe("debet");
  });
});
